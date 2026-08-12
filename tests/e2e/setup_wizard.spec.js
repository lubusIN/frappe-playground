const { test, expect } = require('@playwright/test');
const {
    collectFrameNavigations,
    completeSetupWizardIfShown,
    dismissIntroDialogIfShown,
    expectStableDesk,
    loginAsAdministrator,
    waitForPlaygroundBoot,
    readDeskState,
} = require('./helpers/frappeFlow');

test('Frappe Setup Wizard Completion', async ({ page, browserName }) => {
    test.setTimeout(600000);
    const navigations = collectFrameNavigations(page);

    console.log("Navigating to /");
    await waitForPlaygroundBoot(page);

    console.log("Logging in...");
    await loginAsAdministrator(page);

    console.log("Waiting for Setup Wizard or Desk...");
    const setupState = await completeSetupWizardIfShown(page);
    expect(setupState).toBe('wizard');
    await expectStableDesk(page, navigations);

    console.log("Setup complete! Reloading page to test persistence...");
    await page.reload();

    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });

    console.log("Verifying we are on the desk...");
    let stateAfterReload = {};
    await expect.poll(async () => {
        stateAfterReload = await readDeskState(page).catch(() => ({}));
        return stateAfterReload.hasLogin || stateAfterReload.hasSetupWizard || stateAfterReload.setupComplete;
    }, { timeout: 120000 }).toBeTruthy();

    if (stateAfterReload.hasLogin) {
        console.log("Session dropped after reload, logging back in to verify setup completion...");
        await dismissIntroDialogIfShown(page);
        await loginAsAdministrator(page);
    }
    await expectStableDesk(page, navigations);

    console.log("Success! Setup Wizard survived reload.");
});
