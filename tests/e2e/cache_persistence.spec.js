const { test, expect } = require('@playwright/test');

test('Database state is cached in IndexedDB and seeded only on fresh sessions', async ({ page }) => {
    test.setTimeout(600000);

    const logs = [];
    page.on('console', msg => logs.push(msg.text()));

    // 1. First load (cold start)
    console.log('--- Initial Boot ---');
    await page.goto('/');
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });
    await expect(page.locator('#frappe-desk')).toBeVisible({ timeout: 120000 });

    // Verify it seeded a fresh database and saved it
    expect(logs.some(l => l.includes('saveInitialStateToIDB'))).toBeTruthy();
    expect(logs.some(l => l.includes('loadStateFromIDB'))).toBeFalsy();

    // Clear logs for the next phase
    logs.length = 0;

    // 2. Reload page (simulating coming back the next day or refreshing)
    console.log('--- Subsequent Boot (from Cache) ---');
    await page.goto('/');
    
    // Wait for the UI to be fully booted
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });
    await expect(page.locator('#frappe-desk')).toBeVisible({ timeout: 120000 });

    // Verify it restored from IndexedDB and skipped seeding entirely
    expect(logs.some(l => l.includes('loadStateFromIDB'))).toBeTruthy();
    expect(logs.some(l => l.includes('saveInitialStateToIDB'))).toBeFalsy();
    
    // Verify it didn't extract packages (virtual environment was cached)
    expect(logs.some(l => l.includes('[Worker] Restored virtual environment from IDBFS. Skipping extraction.'))).toBeTruthy();
});

test('an uncloneable save value leaves the previous IndexedDB snapshot intact', async ({ page }) => {
  await page.goto('/docs/')
  const result = await page.evaluate(async () => {
    const { BrowserStateStore } = await import('/server/persistence.js')
    const scope = `atomic-save-${crypto.randomUUID()}`
    let bytes = new Uint8Array([1, 2, 3])
    const options = { indexedDB, scope, getFs: () => ({
      readFile: () => bytes,
      writeFile: (_path, restored) => { bytes = restored },
    }) }
    try {
      const store = new BrowserStateStore(options)
      await store.preloadedState
      await store.save('/site.db')
      bytes = new Uint8Array([9, 9, 9])
      let errorName
      try { await store.save('/site.db', () => {}) } catch (error) { errorName = error.name }
      const restored = new BrowserStateStore(options)
      const outcome = await restored.load('/site.db')
      return { errorName, status: outcome.status, bytes: [...bytes] }
    } finally {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(`frappe_playground_db_${scope}`)
        request.onsuccess = resolve
        request.onerror = () => reject(request.error)
      })
    }
  })
  expect(result).toEqual({ errorName: 'DataCloneError', status: 'restored', bytes: [1, 2, 3] })
})
