// ──────────────────────────────────────────────────────────────────────────────
// Frappe WASM Playground — Web Worker (Pyodide Runtime Sandbox)
// ──────────────────────────────────────────────────────────────────────────────
import { loadPyodide } from "/pyodide/pyodide.mjs";
import { PYTHON_PACKAGES, BENCH_DIRECTORIES, SITE_CONFIG } from "./config.js";

let pyodide;
let fromServiceWorkerPort;
let isFreshSession = true;

// Local Express server serves storage/ at this endpoint
const STORAGE_ENDPOINT = `${self.location.origin}/storage`;

// ─── Custom IndexedDB Persistence ──────────────────────────────────
// We use a custom IndexedDB sync mechanism instead of Emscripten IDBFS because
// it allows us to precisely control when and how the database is persisted,
// avoiding race conditions and silent corruption issues with SQLite WAL mode.

function openIDB() {
    return new Promise((resolve, reject) => {
        // Use a single database name for the entire browser session
        const dbName = `frappe_playground_db`;
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore("files");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// Syncs an entire MEMFS directory (including SQLite .db, -wal, and -shm files) to IndexedDB
async function saveDirectoryToIDB(dirPath) {
    try {
        const files = pyodide.FS.readdir(dirPath);
        const db = await openIDB();
        
        await new Promise((resolve, reject) => {
            const tx = db.transaction("files", "readwrite");
            const store = tx.objectStore("files");
            
            let savedCount = 0;
            // Overwrite files with current MEMFS contents
            for (const f of files) {
                if (f !== "." && f !== "..") {
                    try {
                        const data = pyodide.FS.readFile(`${dirPath}/${f}`);
                        store.put(data, f);
                        savedCount++;
                    } catch (e) {
                        // File might be transient, ignore
                    }
                }
            }
            
            tx.oncomplete = () => { 
                db.close(); 
                resolve(); 
            };
            tx.onerror = () => { db.close(); reject(tx.error); };
        });
    } catch (err) {
        console.warn("[Worker] Failed to sync directory to IDB:", err);
    }
}

// Restores an entire directory from IndexedDB into MEMFS
async function loadDirectoryFromIDB(dirPath) {
    try {
        const db = await openIDB();
        const loaded = await new Promise((resolve, reject) => {
            const tx = db.transaction("files", "readonly");
            const store = tx.objectStore("files");
            const req = store.getAllKeys();
            
            req.onsuccess = async () => {
                const keys = req.result;
                if (keys.length === 0) {
                    console.log("[Worker] IDB is empty");
                    db.close();
                    resolve(false);
                    return;
                }
                
                console.log("[Worker] Restoring keys from IDB:", keys);
                // Read all files and write them to Pyodide MEMFS
                for (const key of keys) {
                    const getReq = store.get(key);
                    getReq.onsuccess = () => {
                        pyodide.FS.writeFile(`${dirPath}/${key}`, getReq.result);
                    };
                }
                tx.oncomplete = () => { db.close(); resolve(true); };
            };
            req.onerror = () => { db.close(); reject(tx.error); };
        });
        return loaded;
    } catch (err) {
        console.warn("[Worker] Failed to load directory from IDB:", err);
        return false;
    }
}

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

    // Globally suppress Python 3.12+ SyntaxWarnings (like whoosh's invalid escape sequences) 
    // before any packages are installed or compiled.
    await pyodide.runPythonAsync(`
        import warnings
        warnings.filterwarnings("ignore", category=SyntaxWarning)
        warnings.filterwarnings("ignore", category=DeprecationWarning)
    `);

    self.postMessage({ type: "LOG", message: "Loading core packages..." });
    await pyodide.loadPackage(["micropip", "cryptography", "tzdata"]);

    self.postMessage({ type: "LOG", message: "Installing Python dependencies..." });
    const micropip = pyodide.pyimport("micropip");
    await micropip.install(PYTHON_PACKAGES, { keep_going: true });
}

async function fetchAndMountFilesystem() {
    self.postMessage({ type: "LOG", message: "Fetching Frappe runtime..." });
    const [codeRes, docoptRes, num2wordsRes, assetsRes] = await Promise.all([
        fetch(`${STORAGE_ENDPOINT}/frappe_runtime.tar.gz`),
        fetch(`${self.location.origin}/wheels/docopt-0.6.2-py2.py3-none-any.whl`),
        fetch(`${self.location.origin}/wheels/num2words-0.5.14-py3-none-any.whl`),
        fetch(`${STORAGE_ENDPOINT}/assets/assets.json`),
    ]);

    const codeArr = new Uint8Array(await codeRes.arrayBuffer());
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

    // ─── Database Persistence ───────────────────────────────────────────────
    // If it's a fresh session (new tab), we seed a fresh database and save it.
    // If it's a reload, we load the entire database directory (including SQLite WAL files).
    
    const dbDir = "/home/pyodide/bench/sites/site1/db";
    let dataLoaded = false;
    
    if (!isFreshSession) {
        self.postMessage({ type: "LOG", message: "Restoring isolated database..." });
        dataLoaded = await loadDirectoryFromIDB(dbDir);
    }
    
    if (isFreshSession || !dataLoaded) {
        self.postMessage({ type: "LOG", message: "Seeding fresh database..." });
        const dbRes = await fetch(`${STORAGE_ENDPOINT}/site1.db`);
        const dbArr = new Uint8Array(await dbRes.arrayBuffer());
        pyodide.FS.writeFile(`${dbDir}/site1.db`, dbArr);
        
        // Save the seed immediately to IndexedDB
        await saveDirectoryToIDB(dbDir);
    }

    // Write config files (these are static and always come from the server)
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
        isFreshSession = event.data.freshSession !== false;
        
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
                
                // Force SQLite to checkpoint the WAL and merge all changes into site1.db.
                // SQLite WAL mode relies on shared memory (-shm) files which corrupt
                // easily when restored from IndexedDB. This step deletes the -wal and -shm
                // files, leaving us with a perfectly clean, single site1.db file to save.
                await pyodide.runPythonAsync(`
                    import sqlite3
                    try:
                        conn = sqlite3.connect('/home/pyodide/bench/sites/site1/db/site1.db')
                        conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
                        conn.execute('PRAGMA journal_mode = DELETE')
                        conn.close()
                    except Exception as e:
                        pass
                `);
                
                // Persist database directory to IndexedDB after every write operation.
                await saveDirectoryToIDB("/home/pyodide/bench/sites/site1/db");
                
                let bodyLog = "[empty body]";
                if (jsResponse.body && jsResponse.body.length > 0) {
                    const textStr = new TextDecoder("utf-8").decode(jsResponse.body);
                    bodyLog = textStr.length > 300 ? textStr.substring(0, 300) + "... [truncated]" : textStr;
                }
                console.log("WORKER RESPONSE:", jsResponse.status, "\\n", bodyLog);
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
