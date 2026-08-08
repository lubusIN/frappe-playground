const { test, expect } = require('@playwright/test');
const { waitForPlaygroundBoot } = require('./helpers/frappeFlow');

test('Frappe Playground boots up without crashing', async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER]: ${msg.text()}`));
    page.on('response', response => {
        if (response.status() >= 400) {
            console.log(
                `[BROWSER RESPONSE]: ${response.request().method()} ${response.status()} ${response.url()}`
            );
        }
    });

    const { iframe, instanceId } = await waitForPlaygroundBoot(page);

    await expect(iframe).toHaveAttribute('src', new RegExp(`^/\\?__scope=${instanceId}$`));
});
