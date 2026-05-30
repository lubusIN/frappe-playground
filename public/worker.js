// ──────────────────────────────────────────────────────────────────────────────
// Frappe Playground — Web Worker (Pyodide Runtime Sandbox)
// ──────────────────────────────────────────────────────────────────────────────
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/dev/full/pyodide.mjs";
import { PYTHON_PACKAGES, BENCH_DIRECTORIES, SITE_CONFIG } from "./config.js";

let pyodide;
let fromServiceWorkerPort;
let isFreshSession = true;
let instanceScope = "default";
let persistedCookieJarJson = null;

// Static runtime files are served from /storage; browser assets are served from /assets.
const ORIGIN = self.location.origin;
const STORAGE_ENDPOINT = `${ORIGIN}/storage`;
const ASSETS_ENDPOINT = `${ORIGIN}/assets`;
const SITE_ROOT = "/home/pyodide/bench/sites";
const SITE_NAME = "site1";
const SITE_DB_DIR = `${SITE_ROOT}/${SITE_NAME}/db`;
const SITE_DB_PATH = `${SITE_DB_DIR}/${SITE_NAME}.db`;
const ASSETS_JSON_PATH = `${SITE_ROOT}/assets/assets.json`;
const LOCAL_WHEELS = [
    {
        url: `${ORIGIN}/wheels/docopt-0.6.2-py2.py3-none-any.whl`,
        fsPath: "/home/pyodide/docopt-0.6.2-py2.py3-none-any.whl",
    },
    {
        url: `${ORIGIN}/wheels/num2words-0.5.14-py3-none-any.whl`,
        fsPath: "/home/pyodide/num2words-0.5.14-py3-none-any.whl",
    },
];
const STATIC_SITE_FILES = {
    [`${SITE_ROOT}/apps.txt`]: "frappe\n",
    [`${SITE_ROOT}/currentsite.txt`]: `${SITE_NAME}\n`,
    [`${SITE_ROOT}/${SITE_NAME}/site_config.json`]: JSON.stringify(SITE_CONFIG),
};

// ─── Custom IndexedDB Persistence ──────────────────────────────────
// We use a custom IndexedDB sync mechanism instead of Emscripten IDBFS because
// it allows us to precisely control when and how the database is persisted,
// avoiding race conditions and silent corruption issues with SQLite WAL mode.

function openIDB() {
    return new Promise((resolve, reject) => {
        const dbName = `frappe_playground_db_${instanceScope}`;
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains("files")) {
                req.result.createObjectStore("files");
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function requestToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function fetchOk(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response;
}

async function fetchBinary(url) {
    const response = await fetchOk(url);
    return new Uint8Array(await response.arrayBuffer());
}

async function fetchText(url) {
    const response = await fetchOk(url);
    return response.text();
}

function ensureDirectories(paths) {
    for (const path of paths) {
        try {
            pyodide.FS.mkdir(path);
        } catch (_) {
            // Directory already exists.
        }
    }
}

async function installLocalWheels() {
    const wheelFiles = await Promise.all(LOCAL_WHEELS.map(wheel => fetchBinary(wheel.url)));

    LOCAL_WHEELS.forEach((wheel, index) => {
        pyodide.FS.writeFile(wheel.fsPath, wheelFiles[index]);
    });

    const micropip = pyodide.pyimport("micropip");
    for (const wheel of LOCAL_WHEELS) {
        await micropip.install(`emfs://${wheel.fsPath}`);
    }
}

async function saveStateToIDB(dbPath, cookieJarJson = "{}") {
    try {
        const data = pyodide.FS.readFile(dbPath);
        const db = await openIDB();

        await new Promise((resolve, reject) => {
            const tx = db.transaction("files", "readwrite");
            const store = tx.objectStore("files");

            store.clear();
            store.put(data, "site1.db");
            store.put(cookieJarJson, "cookie_jar.json");
            store.put(JSON.stringify({ savedAt: Date.now(), scope: instanceScope }), "manifest.json");

            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => { db.close(); reject(tx.error); };
        });
    } catch (err) {
        console.warn("[Worker] Failed to persist state to IDB:", err);
    }
}

async function loadStateFromIDB(dbPath) {
    try {
        const db = await openIDB();
        const tx = db.transaction("files", "readonly");
        const store = tx.objectStore("files");
        const siteDbReq = store.get("site1.db");
        const cookieJarReq = store.get("cookie_jar.json");
        const [siteDb, cookieJar] = await Promise.all([
            requestToPromise(siteDbReq),
            requestToPromise(cookieJarReq),
        ]);

        db.close();

        if (!siteDb) {
            console.log("[Worker] IDB is empty");
            return false;
        }

        pyodide.FS.writeFile(dbPath, siteDb);

        if (typeof cookieJar === "string") {
            persistedCookieJarJson = cookieJar;
        }

        return true;
    } catch (err) {
        console.warn("[Worker] Failed to load state from IDB:", err);
        return false;
    }
}

function removeIfExists(path) {
    try {
        if (pyodide.FS.analyzePath(path).exists) {
            pyodide.FS.unlink(path);
        }
    } catch (_) {
        // Ignore transient SQLite sidecar cleanup errors.
    }
}

async function checkpointDatabase(dbPath) {
    await pyodide.runPythonAsync(`
        import sqlite3
        try:
            conn = sqlite3.connect('${dbPath}')
            conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            conn.close()
        except Exception:
            pass
    `);

    removeIfExists(`${dbPath}-wal`);
    removeIfExists(`${dbPath}-shm`);
}

async function repairCompletedSiteDefaults(dbPath) {
    await pyodide.runPythonAsync(`
        import sqlite3

        conn = sqlite3.connect('${dbPath}')
        try:
            app_setup_values = [
                row[0]
                for row in conn.execute(
                    "select is_setup_complete from 'tabInstalled Application' where app_name in ('frappe', 'erpnext')"
                ).fetchall()
            ]
            home_page = conn.execute(
                "select defvalue from tabDefaultValue where parent='__default' and defkey='desktop:home_page'"
            ).fetchone()

            if app_setup_values and all(bool(value) for value in app_setup_values) and home_page and home_page[0] == "setup-wizard":
                conn.execute(
                    "update tabDefaultValue set defvalue='workspace' where parent='__default' and defkey='desktop:home_page'"
                )
                conn.commit()
        finally:
            conn.close()
    `);
}

async function resetFreshSiteSetupState(dbPath) {
    await pyodide.runPythonAsync(`
        import sqlite3

        conn = sqlite3.connect('${dbPath}')
        try:
            conn.execute(
                "update tabSingles set value='0' where doctype='System Settings' and field='setup_complete'"
            )
            conn.execute("update 'tabInstalled Application' set is_setup_complete=0")

            updated = conn.execute(
                "update tabDefaultValue set defvalue='setup-wizard' where parent='__default' and defkey='desktop:home_page'"
            ).rowcount
            if not updated:
                conn.execute(
                    "insert into tabDefaultValue (name, parent, defkey, defvalue) values (?, '__default', 'desktop:home_page', 'setup-wizard')",
                    ("__default:desktop:home_page",),
                )

            conn.commit()
        finally:
            conn.close()
    `);
}

async function exportCookieJarJson() {
    try {
        return await pyodide.runPythonAsync(`
            import json
            json.dumps(globals().get("_cookie_jar", {}))
        `);
    } catch (_) {
        return "{}";
    }
}

async function restoreCookieJarFromIDB() {
    if (!persistedCookieJarJson) return;

    await pyodide.runPythonAsync(`
        import json
        _cookie_jar = json.loads(${JSON.stringify(persistedCookieJarJson)})
    `);
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
    const [codeArr, assetsJson] = await Promise.all([
        fetchBinary(`${STORAGE_ENDPOINT}/frappe_runtime.tar.gz`),
        fetchText(`${ASSETS_ENDPOINT}/assets.json`),
    ]);

    self.postMessage({ type: "LOG", message: "Mounting virtual filesystem..." });
    pyodide.FS.mkdir("/home/pyodide/frappe_env");
    pyodide.unpackArchive(codeArr, "gztar", { extractDir: "/home/pyodide/frappe_env" });
    await installLocalWheels();

    // Create Bench directory structure
    ensureDirectories(BENCH_DIRECTORIES);

    // ─── Database Persistence ───────────────────────────────────────────────
    // Fresh tabs get a seed database. Reloads restore this tab's atomic snapshot.
    
    let dataLoaded = false;
    
    if (!isFreshSession) {
        self.postMessage({ type: "LOG", message: "Restoring isolated database..." });
        dataLoaded = await loadStateFromIDB(SITE_DB_PATH);
    }
    
    if (isFreshSession || !dataLoaded) {
        self.postMessage({ type: "LOG", message: "Seeding fresh database..." });
        const dbArr = await fetchBinary(`${STORAGE_ENDPOINT}/site1.db`);
        pyodide.FS.writeFile(SITE_DB_PATH, dbArr);

        await resetFreshSiteSetupState(SITE_DB_PATH);
        
        // Save the seed immediately to IndexedDB
        await saveStateToIDB(SITE_DB_PATH);
    } else {
        await repairCompletedSiteDefaults(SITE_DB_PATH);
    }

    // Write config files (these are static and always come from the server)
    pyodide.FS.writeFile(ASSETS_JSON_PATH, assetsJson);
    for (const [path, contents] of Object.entries(STATIC_SITE_FILES)) {
        pyodide.FS.writeFile(path, contents);
    }
}

async function configureFrappeEnvironment() {
    self.postMessage({ type: "LOG", message: "Configuring Python environment..." });
    
    const [mocksRes, wsgiRes] = await Promise.all([
        fetchOk("/python/frappe_mocks.py"),
        fetchOk("/python/wsgi_server.py"),
    ]);

    const mocksCode = await mocksRes.text();
    const wsgiCode = await wsgiRes.text();

    await pyodide.runPythonAsync(mocksCode);
    await pyodide.runPythonAsync(wsgiCode);
    await restoreCookieJarFromIDB();
}

// ─── WSGI Request Handler ───────────────────────────────────────────────────

self.onmessage = async (event) => {
    if (event.data && event.data.type === "INIT_CHANNEL") {
        fromServiceWorkerPort = event.ports[0];
        isFreshSession = event.data.freshSession !== false;
        instanceScope = event.data.scope || "default";
        
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
                
                const hasSetCookie = (jsResponse.headers || []).some(([name]) => name.toLowerCase() === "set-cookie");
                const shouldPersist = !["GET", "HEAD", "OPTIONS"].includes(req.method) || hasSetCookie;

                if (shouldPersist) {
                    await checkpointDatabase(SITE_DB_PATH);
                    await saveStateToIDB(SITE_DB_PATH, await exportCookieJarJson());
                }
                
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
