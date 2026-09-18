const { test, expect } = require('@playwright/test');
const { waitForPlaygroundBoot } = require('./helpers/frappeFlow');

test.describe('Service Worker Resiliency', () => {
    test('recovers connection if BroadcastChannel requests re-init', async ({ page }) => {
        const whooshWarnings = [];
        page.on('console', msg => {
            console.log(`[PAGE] ${msg.type()}: ${msg.text()}`);
            if (/\/whoosh\/.*(?:SyntaxWarning|DeprecationWarning).*invalid escape sequence/.test(msg.text())) {
                whooshWarnings.push(msg.text());
            }
        });
        await waitForPlaygroundBoot(page);

        // Force the SW to lose its port by simulating a BroadcastChannel event
        await page.evaluate(async () => {
            const { createRecoveryRequestMessage } = await import('/protocol/messages.js');
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
        expect(whooshWarnings).toEqual([]);
    });
});
