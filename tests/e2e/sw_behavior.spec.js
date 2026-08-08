const { test, expect } = require('@playwright/test');
const { waitForPlaygroundBoot, loginAsAdministrator } = require('./helpers/frappeFlow');

test.describe('Service Worker Resiliency', () => {
    test.skip(({ browserName }) => browserName === 'webkit', 'WebKit SW behavior varies heavily under COEP isolation');

    test('recovers connection if BroadcastChannel requests re-init', async ({ page }) => {
        page.on('console', msg => console.log(`[PAGE] ${msg.type()}: ${msg.text()}`));
        page.on('worker', worker => {
            worker.on('console', msg => console.log(`[WORKER-LOG] ${msg.type()}: ${msg.text()}`));
        });
        const { instanceId } = await waitForPlaygroundBoot(page);

        // Force the SW to lose its port by simulating a BroadcastChannel event
        await page.evaluate(async () => {
            const { createRecoveryRequestMessage } = await import('/protocol/index.js');
            const bc = new BroadcastChannel('sw-recovery');
            bc.postMessage(createRecoveryRequestMessage());
        });

        // Wait a beat for the App.vue listener to handle it
        await page.waitForTimeout(500);

        // Verify the connection works again by fetching something that needs pyodide
        const { status, body } = await page.evaluate(async () => {
            const res = await fetch('/api/method/ping');
            return { status: res.status, body: await res.text() };
        });
        console.log("Ping response status:", status);
        console.log("Ping response body:", body);
        expect(status).toBe(200);
    });
});
