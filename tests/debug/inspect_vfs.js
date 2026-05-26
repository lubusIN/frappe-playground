const { bootPlayground } = require('./setup');

const PATH_TO_INSPECT = process.argv[2] || "/home/pyodide/bench/sites/site1/site_config.json";

(async () => {
    console.log(`🚀 Starting VFS Inspection for: ${PATH_TO_INSPECT}`);
    const { browser, page } = await bootPlayground(false);

    try {

        console.log("⏳ Running Python inspection script inside Service Worker...");
        const result = await page.evaluate(async (targetPath) => {
            // Because we don't have a direct /debug_vfs route, we can inject a script via pyodide directly 
            // if we were in the main thread, but since pyodide is in the SW, we must use fetch 
            // against a custom route if we added one, or we can use the /find_redis approach.
            // For now, this script expects a debug route like /debug_vfs in worker.js.
            // If it doesn't exist, this is a placeholder for where that logic goes.
            try {
                const r = await fetch('/debug_vfs?path=' + encodeURIComponent(targetPath));
                if (!r.ok) return "Error or route not implemented in worker.js";
                return await r.text();
            } catch (e) {
                return e.toString();
            }
        }, PATH_TO_INSPECT);

        console.log("\n=== VFS CONTENTS ===");
        console.log(result);
        console.log("====================\n");

        process.exit(0);
    } catch (err) {
        console.error("❌ Inspection Failed:", err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
