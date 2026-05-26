const { test, expect } = require('@playwright/test');

test('Frappe WASM boots up without crashing', async ({ page }) => {
    // Navigate to the root URL (baseURL is set in playwright.config.js)
    await page.goto('/');

    // Wait for the loading screen to disappear
    const loadingScreen = page.locator('#loading-screen');
    await expect(loadingScreen).toBeHidden({ timeout: 600000 }); // up to 10 minutes for full Pyodide boot
    
    // Check that the iframe is now present
    const iframe = page.locator('#frappe-desk');
    await expect(iframe).toBeAttached();
});
