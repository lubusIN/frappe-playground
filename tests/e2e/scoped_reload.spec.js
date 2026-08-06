const { test, expect } = require('@playwright/test');

test('iframe and main page reload keep the same scoped runtime', async ({ page, browserName }) => {
    test.skip(
        browserName === 'webkit',
        'Playwright WebKit blocks the module worker reload path under COEP even though real Safari allows it.'
    );

    test.setTimeout(600000);

    page.on('console', msg => console.log(`[PAGE] ${msg.type()}: ${msg.text()}`));

    await page.goto('/');
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });

    const firstInstanceId = await page.evaluate(() => localStorage.getItem('frappe_playground_instance_id'));
    const iframe = page.locator('#frappe-desk');

    // Wait for the iframe to be fully loaded and visible
    await expect(iframe).toBeVisible({ timeout: 120000 });
    
    // The instance id should be preserved and the scope should remain identical
    await expect(iframe).toHaveAttribute('src', new RegExp(`^/\\?__scope=${firstInstanceId}$`));

    const frame = await iframe.elementHandle();
    const contentFrame = await frame.contentFrame();
    console.log('Reloading iframe...');
    await contentFrame.evaluate(() => location.reload());
    console.log('Iframe reloaded! Checking src...');
    await expect(iframe).toHaveAttribute('src', new RegExp(`^/\\?__scope=${firstInstanceId}$`));

    console.log('Waiting 2s for iframe reload to settle...');
    await page.waitForTimeout(2000);

    console.log('Reloading main page...');
    await page.goto('/');
    console.log('Main page reloaded! Waiting for loading screen to be hidden...');
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });
    console.log('Loading screen hidden!');

    const reloadedInstanceId = await page.evaluate(() => localStorage.getItem('frappe_playground_instance_id'));
    await expect(page.locator('#frappe-desk')).toHaveAttribute('src', new RegExp(`^/\\?__scope=${firstInstanceId}$`));
    expect(reloadedInstanceId).toBe(firstInstanceId);
});
