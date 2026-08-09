const { test, expect } = require('@playwright/test');
const { bootLoginAndReachDesk, getFrappeFrame } = require('./helpers/frappeFlow');

test.describe('File Upload', () => {
    test('Can upload a file successfully and retrieve it', async ({ page }) => {
        test.setTimeout(180000); // 3 minutes for full boot + upload

        const { instanceId } = await bootLoginAndReachDesk(page);
        const frame = await getFrappeFrame(page);

        // We use frame.evaluate to execute a fetch request directly to test the backend's multipart parsing.
        // A valid 1x1 PNG exercises binary response transport and browser image
        // decoding, which a text fixture cannot cover.
        const testFileBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
        
        const uploadResult = await frame.evaluate(async (fileBase64) => {
            const formData = new FormData();
            const bytes = Uint8Array.from(atob(fileBase64), char => char.charCodeAt(0));
            const blob = new Blob([bytes], { type: 'image/png' });
            formData.append('file', blob, 'test upload.png');
            formData.append('is_private', '0');
            formData.append('folder', 'Home');

            const res = await fetch('/api/method/upload_file', {
                method: 'POST',
                body: formData,
                headers: {
                    'X-Frappe-CSRF-Token': window.frappe.csrf_token
                }
            });

            return res.json();
        }, testFileBase64);

        // Verify the upload API returned the File document successfully
        expect(uploadResult.message).toBeDefined();
        expect(uploadResult.message.file_name).toBe('test upload.png');
        expect(uploadResult.message.file_url).toContain('test upload.png');
        expect(uploadResult.message.file_url).toBeTruthy();

        // Verify we can fetch the uploaded file back from the static server
        const fileUrl = uploadResult.message.file_url;
        
        const fetchedContent = await frame.evaluate(async (url) => {
            const res = await fetch(url);
            return {
                status: res.status,
                contentType: res.headers.get('content-type'),
                base64: btoa(String.fromCharCode(...new Uint8Array(await res.arrayBuffer())))
            };
        }, fileUrl);

        expect(fetchedContent.status).toBe(200);
        expect(fetchedContent.contentType).toBe('image/png');
        expect(fetchedContent.base64).toBe(testFileBase64);

        const logoUpdate = await frame.evaluate(async (url) => {
            const body = new URLSearchParams({
                doctype: 'Website Settings',
                name: 'Website Settings',
                fieldname: 'app_logo',
                value: url,
            });
            const res = await fetch('/api/method/frappe.client.set_value', {
                method: 'POST',
                body,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Frappe-CSRF-Token': window.frappe.csrf_token
                }
            });
            return { status: res.status, body: await res.text() };
        }, fileUrl);
        expect(logoUpdate.status, logoUpdate.body).toBe(200);

        // Logging out replaces the iframe document. The new service-worker
        // client must inherit the same instance before the login page requests
        // public files such as the uploaded website logo.
        const logoutStatus = await frame.evaluate(async () => {
            const res = await fetch('/api/method/logout', {
                method: 'POST',
                headers: {
                    'X-Frappe-CSRF-Token': window.frappe.csrf_token
                }
            });
            return res.status;
        });
        expect(logoutStatus).toBe(200);

        await frame.goto('/login');
        await frame.waitForSelector('#login_email', { timeout: 60000 });

        const renderedLogo = frame.locator(`img[src="${fileUrl}"]:visible`).first();
        const renderedLogoUrl = await renderedLogo.getAttribute('src');
        expect(renderedLogoUrl).toBe(fileUrl);

        const imageAfterLogout = await renderedLogo.evaluate(async image => {
            try {
                await image.decode();
                return { width: image.naturalWidth, height: image.naturalHeight };
            } catch (error) {
                return { error: error.message };
            }
        });

        expect(imageAfterLogout).toEqual({ width: 1, height: 1 });

        // A full shell reload creates a new WASM worker. The File document and
        // its bytes must both be restored from this instance's IndexedDB state.
        await page.reload();
        await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 180000 });
        expect(await page.evaluate(() => localStorage.getItem('frappe_playground_instance_id'))).toBe(instanceId);

        const reloadedFrame = await getFrappeFrame(page);
        const fetchedAfterReload = await reloadedFrame.evaluate(async (url) => {
            const res = await fetch(url);
            return {
                status: res.status,
                contentType: res.headers.get('content-type'),
                base64: btoa(String.fromCharCode(...new Uint8Array(await res.arrayBuffer())))
            };
        }, fileUrl);

        expect(fetchedAfterReload.status).toBe(200);
        expect(fetchedAfterReload.contentType).toBe('image/png');
        expect(fetchedAfterReload.base64).toBe(testFileBase64);
    });
});
