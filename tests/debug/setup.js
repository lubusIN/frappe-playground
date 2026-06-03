const { chromium } = require('playwright');

/**
 * Boots the Frappe playground, optionally logs in, and returns the Playwright browser and page objects.
 * @param {boolean} login - Whether to automatically log in before returning.
 */
async function bootPlayground(login = false) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded' });
        
        console.log("⏳ Waiting for Pyodide...");
        await page.waitForFunction(() => {
            const el = document.getElementById('loading-screen');
            return el && el.style.display === 'none';
        }, null, { timeout: 600000 });

        if (login) {
            console.log("⏳ Logging in...");
            const iframe = await page.waitForSelector('#frappe-desk', { timeout: 30000 });
            const iframeHandle = await iframe.contentFrame();
            
            await iframeHandle.waitForSelector('#login_email', { timeout: 30000 });
            await iframeHandle.fill('#login_email', 'Administrator');
            await iframeHandle.fill('#login_password', 'admin');
            await iframeHandle.click('.btn-login');

            // Wait a few seconds for cookies to be set and redirects to settle
            await page.waitForTimeout(10000); 
        }

        return { browser, page };
    } catch (err) {
        console.error("❌ Setup Failed:", err);
        await browser.close();
        process.exit(1);
    }
}

module.exports = { bootPlayground };
