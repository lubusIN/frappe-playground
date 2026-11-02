const { test, expect } = require('@playwright/test');
const {
    loginAsAdministrator,
    waitForPlaygroundBoot,
    waitForSetupWizardOrDesk,
} = require('./helpers/frappeFlow');

test('Frappe authentication flow succeeds', async ({ page }) => {
    await waitForPlaygroundBoot(page);
    await loginAsAdministrator(page);

    await expect(page.frameLocator('#frappe-desk').locator('#login_email')).toBeHidden({ timeout: 30000 });
    await expect(await waitForSetupWizardOrDesk(page)).toMatch(/wizard|desk/);
});
