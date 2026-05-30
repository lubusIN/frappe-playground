const { expect } = require('@playwright/test');

const ADMIN_EMAIL = 'Administrator';
const ADMIN_PASSWORD = 'admin';

function collectFrameNavigations(page) {
    const navigations = [];

    page.on('framenavigated', frame => {
        navigations.push({
            name: frame === page.mainFrame() ? 'main' : 'iframe',
            url: frame.url(),
            timestamp: Date.now(),
        });
    });

    return navigations;
}

async function waitForPlaygroundBoot(page) {
    await page.goto('/');
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });

    const iframe = page.locator('#frappe-desk');
    await expect(iframe).toBeVisible({ timeout: 120000 });
    await dismissIntroDialogIfShown(page);

    const instanceId = await page.evaluate(() => sessionStorage.getItem('frappe_playground_instance_id'));
    expect(instanceId).toBeTruthy();

    return { iframe, instanceId };
}

async function dismissIntroDialogIfShown(page) {
    const introAction = page.getByRole('button', { name: 'I understand' });

    try {
        await introAction.click({ timeout: 5000 });
    } catch (_) {
        // The dialog is only expected in the shell UI and may already be closed.
    }
}

async function getFrappeFrame(page) {
    const iframeHandle = await page.locator('#frappe-desk').elementHandle();
    const frame = await iframeHandle.contentFrame();
    expect(frame).toBeTruthy();
    return frame;
}

async function loginAsAdministrator(page) {
    const frame = await getFrappeFrame(page);
    await frame.waitForSelector('#login_email', { timeout: 60000 });
    await frame.fill('#login_email', ADMIN_EMAIL);
    await frame.fill('#login_password', ADMIN_PASSWORD);

    const loginResponse = page.waitForResponse(
        response => response.url().endsWith('/login') && response.request().method() === 'POST',
        { timeout: 60000 }
    );

    await frame.click('.btn-login');
    expect((await loginResponse).status()).toBe(200);
}

async function readDeskState(page) {
    const frame = await getFrappeFrame(page);

    return frame.evaluate(() => ({
        href: location.href,
        title: document.title,
        bodyText: document.body.innerText,
        hasLogin: Boolean(document.querySelector('#login_email')),
        hasNestedPlayground: Boolean(document.querySelector('#frappe-desk')),
        hasSetupWizard: Boolean(document.querySelector('.slides-wrapper')),
        homePage: window.frappe?.boot?.home_page,
        route: window.frappe?.get_route?.(),
        setupComplete: window.frappe?.boot?.setup_complete,
    }));
}

async function waitForSetupWizardOrDesk(page) {
    let state = 'loading';

    await expect.poll(async () => {
        const deskState = await readDeskState(page);

        if (deskState.hasSetupWizard) {
            state = 'wizard';
        } else if (deskState.setupComplete || deskState.href.includes('/desk')) {
            state = 'desk';
        } else {
            state = 'loading';
        }

        return state;
    }, { timeout: 120000 }).not.toBe('loading');

    return state;
}

async function completeSetupWizardIfShown(page) {
    const state = await waitForSetupWizardOrDesk(page);

    if (state !== 'wizard') {
        return state;
    }

    const iframe = page.frameLocator('#frappe-desk');
    await expect(iframe.locator('.slide-wrapper:not(.hidden) .slide-title')).toContainText('Welcome');

    await iframe.locator('input[data-fieldname="country"]').fill('United States');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await iframe.locator('select[data-fieldname="timezone"]').selectOption('America/New_York');
    await iframe.locator('select[data-fieldname="currency"]').selectOption('USD');

    const setupCompleteResponse = page.waitForResponse(
        response => response.url().includes('/api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete'),
        { timeout: 120000 }
    );
    await iframe.locator('.complete-btn').click();
    expect((await setupCompleteResponse).status()).toBe(200);

    return state;
}

async function expectStableDesk(page, navigations = []) {
    await expect.poll(async () => {
        const state = await readDeskState(page);
        return (
            state.setupComplete &&
            !state.hasLogin &&
            !state.hasSetupWizard &&
            !state.hasNestedPlayground &&
            !state.bodyText.includes('Page Build not found')
        );
    }, { timeout: 120000 }).toBe(true);

    const state = await readDeskState(page);
    const iframeNavigations = navigations.filter(navigation => navigation.name === 'iframe');
    const deskNavigations = iframeNavigations.filter(navigation => navigation.url === 'http://localhost:8000/desk');

    expect(state.hasNestedPlayground).toBe(false);
    expect(state.hasLogin).toBe(false);
    expect(state.hasSetupWizard).toBe(false);
    expect(state.bodyText).not.toContain('Page Build not found');
    expect(state.href).not.toContain('/desk/build');

    if (state.setupComplete) {
        expect(state.homePage).not.toBe('setup-wizard');
        expect(state.homePage).not.toBe('Build');
    }

    expect(deskNavigations.length).toBeLessThanOrEqual(3);

    return state;
}

async function bootLoginAndReachDesk(page) {
    const navigations = collectFrameNavigations(page);
    const boot = await waitForPlaygroundBoot(page);

    await loginAsAdministrator(page);
    await completeSetupWizardIfShown(page);
    const desk = await expectStableDesk(page, navigations);

    return { ...boot, desk, navigations };
}

module.exports = {
    bootLoginAndReachDesk,
    collectFrameNavigations,
    completeSetupWizardIfShown,
    expectStableDesk,
    getFrappeFrame,
    dismissIntroDialogIfShown,
    loginAsAdministrator,
    readDeskState,
    waitForPlaygroundBoot,
    waitForSetupWizardOrDesk,
};
