const { bootPlayground } = require('./setup');

(async () => {
    console.log("🚀 Starting Memory/Cookie Inspection...");
    const { browser, page } = await bootPlayground(true);

    try {

        console.log("⏳ Fetching Cookie Jar from Service Worker...");
        const result = await page.evaluate(async () => {
            const r = await fetch('/debug_cookies');
            if (!r.ok) return "Error or route not implemented";
            return await r.text();
        });

        console.log("\n=== COOKIE JAR CONTENTS ===");
        console.log(result);
        console.log("===========================\n");

        process.exit(0);
    } catch (err) {
        console.error("❌ Inspection Failed:", err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
