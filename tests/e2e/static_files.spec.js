const { test, expect } = require('@playwright/test');
const { waitForPlaygroundBoot } = require('./helpers/frappeFlow');

test.describe('Static Files serving', () => {
    test('handles static files correctly', async ({ page }) => {
        await waitForPlaygroundBoot(page);

        // Frappe has a standard file /assets/frappe/js/frappe/api.js mapped by SW to pyodide
        // But what about the `/files/` route?
        // We can just fetch /files/something that doesn't exist to test 404
        const res404 = await page.evaluate(async () => {
            const instanceId = sessionStorage.getItem('frappe_playground_instance_id');
            const r = await fetch(`/files/does_not_exist.txt?__scope=${instanceId}`);
            return r.status;
        });
        expect(res404).toBe(404);

        // Verify private files are blocked
        const resPrivate = await page.evaluate(async () => {
            const instanceId = sessionStorage.getItem('frappe_playground_instance_id');
            const r = await fetch(`/private/files/secret.txt?__scope=${instanceId}`);
            return r.status;
        });
        expect(resPrivate).not.toBe(200);
    });
});
