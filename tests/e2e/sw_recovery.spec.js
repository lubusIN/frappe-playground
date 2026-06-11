const { test, expect } = require('@playwright/test');
const { bootLoginAndReachDesk, getFrappeFrame } = require('./helpers/frappeFlow');

test.describe('Service Worker Recovery', () => {
    test('SW correctly recovers lost memory state and reconnects to backend', async ({ page, context }) => {
        page.on('console', msg => console.log(`[PAGE LOG] ${msg.text()}`));
        context.on('weberror', err => console.log(`[WEBERROR] ${err.error().stack}`));
        context.on('console', msg => console.log(`[CONTEXT LOG] ${msg.text()}`));
        // Boot, login, complete setup wizard, and reach desk
        await bootLoginAndReachDesk(page);

        // Get the service worker
        const [worker] = await context.serviceWorkers();
        expect(worker).toBeTruthy();

        // Wipe the Service Worker's memory completely (simulate browser sleep/restart)
        await worker.evaluate(() => {
            instances.clear();
            clientScopes.clear();
        });

        // Trigger a backend request from within the Frappe iframe.
        // If recovery fails, this fetch will hit the static Vite server (resulting in 405) or 503 from the SW.
        const frame = await getFrappeFrame(page);
        
        const responsePromise = page.waitForResponse(
            response => response.url().includes('/api/method/frappe.desk.reportview.get')
        );

        // Fetch a report view (e.g. DocType List) to trigger the API
        await frame.evaluate(() => {
            window.frappe.call({
                method: 'frappe.desk.reportview.get',
                args: { doctype: 'DocType', fields: ['name'], limit_page_length: 1 }
            });
        });

        const response = await responsePromise;
        expect(response.status()).toBe(200);
        
        const json = await response.json();
        expect(json.message).toBeDefined();
    });
});
