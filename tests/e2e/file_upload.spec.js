const { test, expect } = require('@playwright/test');
const { bootLoginAndReachDesk, getFrappeFrame } = require('./helpers/frappeFlow');

test.describe('File Upload', () => {
    test('Can upload a file successfully and retrieve it', async ({ page }) => {
        test.setTimeout(180000); // 3 minutes for full boot + upload

        const { instanceId } = await bootLoginAndReachDesk(page);
        const frame = await getFrappeFrame(page);

        // We use frame.evaluate to execute a fetch request directly to test the backend's multipart parsing.
        const testFileContent = 'hello world binary bytes';
        
        const uploadResult = await frame.evaluate(async (fileContent) => {
            const formData = new FormData();
            const blob = new Blob([fileContent], { type: 'text/plain' });
            formData.append('file', blob, 'test_upload.txt');
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
        }, testFileContent);

        // Verify the upload API returned the File document successfully
        expect(uploadResult.message).toBeDefined();
        expect(uploadResult.message.file_name).toBe('test_upload.txt');
        expect(uploadResult.message.file_url).toBeTruthy();

        // Verify we can fetch the uploaded file back from the static server
        const fileUrl = uploadResult.message.file_url;
        
        const fetchedContent = await page.evaluate(async ({ url, scope }) => {
            const res = await fetch(`${url}?__scope=${scope}`);
            return {
                status: res.status,
                text: await res.text()
            };
        }, { url: fileUrl, scope: instanceId });

        expect(fetchedContent.status).toBe(200);
        expect(fetchedContent.text).toBe(testFileContent);
    });
});
