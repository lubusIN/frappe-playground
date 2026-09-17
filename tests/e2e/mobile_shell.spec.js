const { test, expect } = require('@playwright/test');

test.use({
    viewport: { width: 390, height: 664 },
    userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});

test('mobile shell mounts before runtime boot', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    // Hold the runtime pending so this checks shell layout independently of
    // download speed. The real iframe is intentionally mounted only on ready.
    await page.addInitScript(() => {
        window.Worker = class extends EventTarget {
            constructor() {
                super();
                window.runtimeWorkerCreated = true;
            }
            postMessage() {}
            terminate() {}
        };
    });
    await page.goto('/');

    await expect.poll(() => page.evaluate(() => window.runtimeWorkerCreated)).toBe(true);
    await expect(page.locator('#loading-screen')).toBeVisible();
    await expect(page.locator('#frappe-desk')).toHaveCount(0);
    await expect(page.locator('main')).toHaveCSS('height', '664px');
    expect(pageErrors).toEqual([]);
});
