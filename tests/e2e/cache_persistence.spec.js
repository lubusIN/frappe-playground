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
