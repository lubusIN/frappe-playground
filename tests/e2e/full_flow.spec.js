const { test, expect } = require('@playwright/test');
const {
    collectFrameNavigations,
    completeSetupWizardIfShown,
    expectStableDesk,
    loginAsAdministrator,
    waitForPlaygroundBoot,
} = require('./helpers/frappeFlow');

test('full boot login setup desk flow reaches stable Desk without redirect loop', async ({ page, browserName }) => {
    test.setTimeout(600000);

    const navigations = collectFrameNavigations(page);
    const { instanceId } = await waitForPlaygroundBoot(page);
    await loginAsAdministrator(page);

    const setupState = await completeSetupWizardIfShown(page);
    expect(setupState).toMatch(/wizard|desk/);

    const desk = await expectStableDesk(page, navigations);
    const iframeNavigations = navigations.filter(navigation => navigation.name === 'iframe');
    const deskNavigations = iframeNavigations.filter(
        navigation => new URL(navigation.url).pathname === '/desk'
    );

    expect(instanceId).toBeTruthy();
    expect(desk.href).toContain('/desk');
    expect(desk.href).not.toContain('/desk/build');
});
