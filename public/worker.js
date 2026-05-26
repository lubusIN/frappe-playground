// ──────────────────────────────────────────────────────────────────────────────
// Frappe WASM Playground — Web Worker (Pyodide Runtime Sandbox)
// ──────────────────────────────────────────────────────────────────────────────
import { loadPyodide } from "/pyodide/pyodide.mjs";
import { PYTHON_PACKAGES, BENCH_DIRECTORIES, SITE_CONFIG } from "./config.js";

let pyodide;
let fromServiceWorkerPort;

// Local Express server serves storage/ at this endpoint
const STORAGE_ENDPOINT = `${self.location.origin}/storage`;

// ─── Boot Sequence ──────────────────────────────────────────────────────────

async function bootPython() {
    await initPyodideAndPackages();
    await fetchAndMountFilesystem();
    await configureFrappeEnvironment();
    
    self.postMessage({ type: "LOG", message: "Frappe booted successfully!" });
    self.postMessage({ type: "READY" });
}

async function initPyodideAndPackages() {
    self.postMessage({ type: "LOG", message: "Loading Pyodide..." });
    pyodide = await loadPyodide();

    self.postMessage({ type: "LOG", message: "Loading core packages..." });
    await pyodide.loadPackage(["micropip", "cryptography", "tzdata"]);

    self.postMessage({ type: "LOG", message: "Installing Python dependencies..." });
    const micropip = pyodide.pyimport("micropip");
    await micropip.install(PYTHON_PACKAGES, { keep_going: true });
}

async function fetchAndMountFilesystem() {
    self.postMessage({ type: "LOG", message: "Fetching Frappe runtime..." });
    const [codeRes, dbRes, docoptRes, num2wordsRes, assetsRes] = await Promise.all([
        fetch(`${STORAGE_ENDPOINT}/frappe_runtime.tar.gz`),
        fetch(`${STORAGE_ENDPOINT}/site1.db`),
        fetch(`${self.location.origin}/wheels/docopt-0.6.2-py2.py3-none-any.whl`),
        fetch(`${self.location.origin}/wheels/num2words-0.5.14-py3-none-any.whl`),
        fetch(`${STORAGE_ENDPOINT}/assets/assets.json`),
    ]);

    const codeArr = new Uint8Array(await codeRes.arrayBuffer());
    const dbArr  = new Uint8Array(await dbRes.arrayBuffer());
    const docoptArr = new Uint8Array(await docoptRes.arrayBuffer());
    const num2wordsArr = new Uint8Array(await num2wordsRes.arrayBuffer());
    const assetsJson = await assetsRes.text();

    self.postMessage({ type: "LOG", message: "Mounting virtual filesystem..." });
    pyodide.FS.mkdir("/home/pyodide/frappe_env");
    pyodide.unpackArchive(codeArr, "gztar", { extractDir: "/home/pyodide/frappe_env" });

    // Write wheels to FS for emfs:// install
    pyodide.FS.writeFile("/home/pyodide/docopt-0.6.2-py2.py3-none-any.whl", docoptArr);
    pyodide.FS.writeFile("/home/pyodide/num2words-0.5.14-py3-none-any.whl", num2wordsArr);
    
    const micropip = pyodide.pyimport("micropip");
    await micropip.install("emfs:///home/pyodide/docopt-0.6.2-py2.py3-none-any.whl");
    await micropip.install("emfs:///home/pyodide/num2words-0.5.14-py3-none-any.whl");

    // Create Bench directory structure
    for (const d of BENCH_DIRECTORIES) {
        try { pyodide.FS.mkdir(d); } catch (_) { /* exists */ }
    }

    // Write site database and config files
    pyodide.FS.writeFile("/home/pyodide/bench/sites/site1/db/site1.db", dbArr);
    pyodide.FS.writeFile("/home/pyodide/bench/sites/assets/assets.json", assetsJson);
    pyodide.FS.writeFile("/home/pyodide/bench/sites/apps.txt", "frappe\n");
    pyodide.FS.writeFile("/home/pyodide/bench/sites/currentsite.txt", "site1\n");
    pyodide.FS.writeFile("/home/pyodide/bench/sites/site1/site_config.json", JSON.stringify(SITE_CONFIG));
}

async function configureFrappeEnvironment() {
    self.postMessage({ type: "LOG", message: "Configuring Python environment..." });
    
    const [mocksRes, wsgiRes] = await Promise.all([
        fetch('/python/frappe_mocks.py'),
        fetch('/python/wsgi_server.py')
    ]);

    const mocksCode = await mocksRes.text();
    const wsgiCode = await wsgiRes.text();

    await pyodide.runPythonAsync(mocksCode);
    await pyodide.runPythonAsync(wsgiCode);
}

// ─── WSGI Request Handler ───────────────────────────────────────────────────

self.onmessage = async (event) => {
    if (event.data && event.data.type === "INIT_CHANNEL") {
        fromServiceWorkerPort = event.ports[0];
        
        // Wait for Pyodide to finish booting BEFORE handling ANY requests
        try {
            await bootPython();
            fromServiceWorkerPort.postMessage({ type: "READY" });
        } catch (err) {
            console.error("Failed to boot Pyodide:", err);
            return;
        }

        const requestQueue = [];
        let processing = false;

        async function processQueue() {
            if (processing || requestQueue.length === 0) return;
            processing = true;

            const { req, responsePort } = requestQueue.shift();
            console.log("WORKER PROCESSING REQUEST:", req.method, req.path);

            try {
                // Initialize the Python function proxy if not already done
                if (!self.pyHandleRequest) {
                    self.pyHandleRequest = pyodide.globals.get("handle_request");
                }
                
                // Convert JS request to a Python Dict proxy
                const pyReq = pyodide.toPy(req);
                
                // Call the native Python WSGI handler directly
                const pyResponse = self.pyHandleRequest(pyReq);
                
                // Convert the returned Python Dict back to a native JS Map/Object
                const jsResponse = pyResponse.toJs({ dict_converter: Object.fromEntries });
                
                // Cleanup proxies to prevent memory leaks
                pyReq.destroy();
                pyResponse.destroy();
                
                console.log("WORKER RESPONSE:", jsResponse.status, jsResponse.body);
                responsePort.postMessage(jsResponse);
            } catch (err) {
                // If Pyodide itself crashes, return a 500 so the SW doesn't hang
                responsePort.postMessage({
                    status: 500,
                    headers: { "Content-Type": "text/plain" },
                    body: `Worker error: ${err.message}\n${err.stack || ""}`,
                });
            } finally {
                processing = false;
                setTimeout(processQueue, 0);
            }
        }

        fromServiceWorkerPort.onmessage = (reqEvent) => {
            requestQueue.push({
                req: reqEvent.data,
                responsePort: reqEvent.ports[0]
            });
            processQueue();
        };
        
    }
};
