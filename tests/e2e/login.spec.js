const { test, expect } = require('@playwright/test');

test('Frappe authentication flow succeeds', async ({ page }) => {
    // Navigate and wait for boot
    await page.goto('/');
    const loadingScreen = page.locator('#loading-screen');
    await expect(loadingScreen).toBeHidden({ timeout: 600000 });

    // Target the Frappe Desk iframe
    const iframeLocator = page.frameLocator('#frappe-desk');

    // Wait for the login form to appear
    await expect(iframeLocator.locator('#login_email')).toBeVisible({ timeout: 30000 });
    
    // Fill in credentials
    await iframeLocator.locator('#login_email').fill('Administrator');
    await iframeLocator.locator('#login_password').fill('admin');
    
    // Click login
    await iframeLocator.locator('.btn-login').click();

    // Verify the login button disappears, meaning we authenticated and are redirecting
    await expect(iframeLocator.locator('.btn-login')).toBeHidden({ timeout: 30000 });
});
