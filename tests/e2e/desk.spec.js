const { test, expect } = require('@playwright/test');
const { bootLoginAndReachDesk } = require('./helpers/frappeFlow');

test('Frappe Setup Wizard / Desk loads successfully', async ({ page, browserName }) => {
    const { desk } = await bootLoginAndReachDesk(page);

    expect(desk.setupComplete).toBe(true);
    expect(desk.hasLogin).toBe(false);
    expect(desk.hasSetupWizard).toBe(false);
    expect(desk.bodyText).toContain('Framework');
});
