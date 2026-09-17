const { test, expect } = require('@playwright/test');
const { waitForPlaygroundBoot, bootLoginAndReachDesk, getFrappeFrame } = require('./helpers/frappeFlow');

test.describe('Static Files serving', () => {
    test('published media works while Python retains form scripts and print templates', async ({ page }) => {
        await bootLoginAndReachDesk(page);
        const frame = await getFrappeFrame(page);
        const result = await frame.evaluate(async () => {
            const image = new Image();
            image.src = '/assets/frappe/images/frappe-logo.png';
            await image.decode();
            const font = new FontFace('RuntimeAssetTest', 'url(/assets/frappe/css/fonts/inter/InterVariable.woff2)');
            await font.load();
            const sound = await fetch('/assets/frappe/sounds/click.mp3');
            const soundBytes = (await sound.arrayBuffer()).byteLength;
            const form = await frappe.call('frappe.desk.form.load.getdoctype', { doctype: 'Website Settings' });
            return {
                imageWidth: image.naturalWidth,
                fontStatus: font.status,
                soundStatus: sound.status,
                soundBytes,
                hasServerLoadedScript: form.docs.some(doc => doc.__js?.includes('open_web_template_values_editor')),
            };
        });
        expect(result.imageWidth).toBeGreaterThan(0);
        expect(result.fontStatus).toBe('loaded');
        expect(result.soundStatus).toBe(200);
        expect(result.soundBytes).toBeGreaterThan(0);
        expect(result.hasServerLoadedScript).toBe(true);

        const print = await frame.evaluate(async () => {
            const { message: doc } = await frappe.call('frappe.client.insert', {
                doc: { doctype: 'ToDo', description: 'Public asset print check' },
            });
            const query = new URLSearchParams({ doctype: 'ToDo', name: doc.name, trigger_print: '0' });
            const response = await fetch(`/printview?${query}`);
            return { status: response.status, html: await response.text() };
        });
        expect(print.status).toBe(200);
        expect(print.html).toContain('Public asset print check');
        expect(print.html).toContain('print.bundle');
    });

    test('handles static files correctly', async ({ page }) => {
        await waitForPlaygroundBoot(page);

        // Uploaded files are served from the scoped Python filesystem.
        const res404 = await page.evaluate(async () => {
            const instanceId = localStorage.getItem('frappe_playground_instance_id');
            const r = await fetch(`/scope:${instanceId}/files/does_not_exist.txt`);
            return r.status;
        });
        expect(res404).toBe(404);

        // Verify private files are blocked
        const resPrivate = await page.evaluate(async () => {
            const instanceId = localStorage.getItem('frappe_playground_instance_id');
            const r = await fetch(`/scope:${instanceId}/private/files/secret.txt`);
            return r.status;
        });
        expect(resPrivate).not.toBe(200);
    });
});
