const { test, expect } = require('@playwright/test');

test('recovers when a controlling service worker leaves the client shell blank', async ({ page }) => {
    test.setTimeout(600000);

    await page.goto('/');
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });

    let blockedEntry = false;
    let recoveryObserved = false;
    page.on('console', message => {
        if (message.text().includes('Recovering from a stale service worker')) {
            recoveryObserved = true;
        }
    });
    await page.route(/\/frontend\/index-[^/]+\.js$/, async route => {
        if (!blockedEntry) {
            blockedEntry = true;
            await route.abort('failed');
            return;
        }
        await route.continue();
    });

    await page.reload();
    await expect.poll(() => recoveryObserved, { timeout: 25000 }).toBe(true);
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });
    await expect(page.locator('#frappe-desk')).toBeVisible({ timeout: 120000 });
    expect(blockedEntry).toBe(true);
});
