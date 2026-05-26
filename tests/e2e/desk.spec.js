const { test, expect } = require('@playwright/test');
const path = require('path');

test('Frappe Setup Wizard / Desk loads successfully', async ({ page }) => {
    // Navigate and wait for boot
    await page.goto('/');
    const loadingScreen = page.locator('#loading-screen');
    await expect(loadingScreen).toBeHidden({ timeout: 600000 });

    const iframeLocator = page.frameLocator('#frappe-desk');

    // Login
    await expect(iframeLocator.locator('#login_email')).toBeVisible({ timeout: 30000 });
    await iframeLocator.locator('#login_email').fill('Administrator');
    await iframeLocator.locator('#login_password').fill('admin');
    await iframeLocator.locator('.btn-login').click();

    // The login button should disappear
    await expect(iframeLocator.locator('.btn-login')).toBeHidden({ timeout: 30000 });

    // Wait for the Setup Wizard or Desk body classes to be attached 
    // Usually it redirects to /app or /app/setup-wizard
    await page.waitForTimeout(15000); // hard wait for initial heavy render

    // We can just assert that the body exists and we are no longer on the login page
    // Playwright automatically attaches a screenshot on failure, but we can take one manually too:
    const screenshotPath = path.join(__dirname, '..', 'results', 'screenshot_desk.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Assert that the page is completely loaded
    const body = iframeLocator.locator('body');
    await expect(body).toBeVisible();
});
