const { test, expect } = require('@playwright/test');
const { waitForPlaygroundBoot } = require('./helpers/frappeFlow');

test('Frappe Playground boots up without crashing', async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER]: ${msg.text()}`));

    const { iframe, instanceId } = await waitForPlaygroundBoot(page);

    await expect(iframe).toHaveAttribute('src', new RegExp(`^/\\?__scope=${instanceId}$`));
});
