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

    await waitForPlaygroundBoot(page);
    await loginAsAdministrator(page);

    const setupState = await completeSetupWizardIfShown(page);
    expect(setupState).toBe('wizard');
    await expectStableDesk(page, navigations);

    await page.reload();

    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });

    let stateAfterReload = {};
    await expect.poll(async () => {
        stateAfterReload = await readDeskState(page).catch(() => ({}));
        return stateAfterReload.hasLogin || stateAfterReload.hasSetupWizard || stateAfterReload.setupComplete;
    }, { timeout: 120000 }).toBeTruthy();

    if (stateAfterReload.hasLogin) {
        await dismissIntroDialogIfShown(page);
        await loginAsAdministrator(page);
    }
    await expectStableDesk(page, navigations);
});
