// ──────────────────────────────────────────────────────────────────────────────
// Frappe WASM Playground — Web Worker (Pyodide Runtime Sandbox)
// ──────────────────────────────────────────────────────────────────────────────
import { loadPyodide } from "/pyodide/pyodide.mjs";

let pyodide;
let fromServiceWorkerPort;

// Local Express server serves storage/ at this endpoint
const STORAGE_ENDPOINT = `${self.location.origin}/storage`;

// ─── Boot Sequence ──────────────────────────────────────────────────────────

async function bootPython() {
    self.postMessage({ type: "LOG", message: "Loading Pyodide..." });

    // 1. Initialize Pyodide engine
    pyodide = await loadPyodide();

    // 2. Load foundational WASM binary packages
    self.postMessage({ type: "LOG", message: "Loading core packages..." });
    await pyodide.loadPackage(["micropip", "cryptography", "tzdata"]);

    // 3. Install pure-Python dependencies from PyPI via micropip
    self.postMessage({ type: "LOG", message: "Installing Python dependencies..." });
    const micropip = pyodide.pyimport("micropip");
    await micropip.install([
        "RestrictedPython", "filetype", "filelock", "pypdf", "passlib",
        "markdown2", "bleach", "bleach-allowlist", "croniter", "cssutils",
        "email-reply-parser", "pydantic", "sqlparse", "sql_metadata",
        "terminaltables", "traceback-with-variables", "typing_extensions",
        "xlrd", "zxcvbn", "markdownify", "PyJWT", "semantic-version",
        "chardet", "html5lib", "oauthlib", "openpyxl", "xlsxwriter",
        "phonenumbers", "premailer", "pyotp", "requests-oauthlib", "rsa",
        "sentry-sdk", "tenacity", "Pillow", "pytz", "requests", "urllib3",
        "nh3", "Babel", "MarkupSafe", "PyYAML", "beautifulsoup4",
        "python-dateutil", "posthog", "pdfkit", "PyMySQL", "whoosh",
    ], { keep_going: true });

    // 4. Fetch runtime assets (Frappe code bundle + pre-baked SQLite DB + local wheels)
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

    // 5. Mount filesystem: Frappe code, site database, wheels
    self.postMessage({ type: "LOG", message: "Mounting virtual filesystem..." });
    pyodide.FS.mkdir("/home/pyodide/frappe_env");
    pyodide.unpackArchive(codeArr, "gztar", { extractDir: "/home/pyodide/frappe_env" });

    // Write wheels to FS for emfs:// install (must use full PEP 427 filenames)
    pyodide.FS.writeFile("/home/pyodide/docopt-0.6.2-py2.py3-none-any.whl", docoptArr);
    pyodide.FS.writeFile("/home/pyodide/num2words-0.5.14-py3-none-any.whl", num2wordsArr);
    await micropip.install("emfs:///home/pyodide/docopt-0.6.2-py2.py3-none-any.whl");
    await micropip.install("emfs:///home/pyodide/num2words-0.5.14-py3-none-any.whl");

    // Create Bench directory structure
    const dirs = [
        "/home/pyodide/bench",
        "/home/pyodide/bench/sites",
        "/home/pyodide/bench/sites/assets",
        "/home/pyodide/bench/sites/site1",
        "/home/pyodide/bench/sites/site1/db",
        "/home/pyodide/bench/sites/site1/locks",
        "/home/pyodide/bench/sites/site1/logs",
        "/home/pyodide/bench/sites/site1/private",
        "/home/pyodide/bench/sites/site1/private/files",
        "/home/pyodide/bench/sites/site1/public",
        "/home/pyodide/bench/sites/site1/public/files",
        "/home/pyodide/bench/logs",
        "/home/logs",
        "/home/pyodide/logs",
    ];
    for (const d of dirs) {
        try { pyodide.FS.mkdir(d); } catch (_) { /* exists */ }
    }

    // Write site database and config files
    pyodide.FS.writeFile("/home/pyodide/bench/sites/site1/db/site1.db", dbArr);
    pyodide.FS.writeFile("/home/pyodide/bench/sites/assets/assets.json", assetsJson);
    pyodide.FS.writeFile("/home/pyodide/bench/sites/apps.txt", "frappe\n");
    pyodide.FS.writeFile("/home/pyodide/bench/sites/currentsite.txt", "site1\n");

    // 6. Configure Python environment and mock unavailable native modules
    self.postMessage({ type: "LOG", message: "Configuring Python environment..." });
    await pyodide.runPythonAsync(`
import sys, os, json, warnings
from types import ModuleType

# Suppress whoosh DeprecationWarnings about invalid escape sequences
warnings.filterwarnings("ignore", category=SyntaxWarning, module=r"whoosh\\..*")
warnings.filterwarnings("ignore", category=DeprecationWarning, module=r"whoosh\\..*")

# Add Frappe source to Python path
sys.path.insert(0, "/home/pyodide/frappe_env")

# ── Mock Module Infrastructure ──────────────────────────────────────

class DummyModule(ModuleType):
    """A mock module that registers itself in sys.modules with a package path."""
    def __init__(self, name):
        super().__init__(name)
        self.__path__ = []

def create_mock(name, **kwargs):
    """Create and register a dummy module with optional attributes."""
    m = DummyModule(name)
    for k, v in kwargs.items():
        setattr(m, k, v)
    sys.modules[name] = m
    return m

class DummyClass:
    pass

class _OmniMock:
    """Returns 0 for any attribute access — used for MySQLdb constant tables."""
    def __getattr__(self, name):
        return 0
    def __call__(self, *a, **k):
        return self

OmniMock = _OmniMock()

# ── Redis Mocks ─────────────────────────────────────────────────────

_dummy_redis_store = {}

class DummyRedisClass:
    @classmethod
    def from_url(cls, *a, **k):
        return cls()

    def ping(self, *a, **k):
        return True

    def get(self, key, *a, **k):
        return _dummy_redis_store.get(key)
        
    def set(self, key, value, *a, **k):
        _dummy_redis_store[key] = value
        
    def delete(self, *keys):
        for k in keys:
            _dummy_redis_store.pop(k, None)
            
    def hget(self, name, key, *a, **k):
        return _dummy_redis_store.get(name, {}).get(key)
        
    def hset(self, name, key, value, *a, **k):
        if name not in _dummy_redis_store:
            _dummy_redis_store[name] = {}
        _dummy_redis_store[name][key] = value
        
    def hdel(self, name, *keys):
        if name in _dummy_redis_store:
            for k in keys:
                _dummy_redis_store[name].pop(k, None)
                
    def hgetall(self, name, *a, **k):
        return _dummy_redis_store.get(name, {})
        
    def sismember(self, name, value, *a, **k):
        return value in _dummy_redis_store.get(name, set())
        
    def sadd(self, name, *values):
        if name not in _dummy_redis_store:
            _dummy_redis_store[name] = set()
        _dummy_redis_store[name].update(values)
        return len(values)
        
    def srem(self, name, *values):
        if name in _dummy_redis_store:
            for v in values:
                _dummy_redis_store[name].discard(v)
        return len(values)
        
    def smembers(self, name, *a, **k):
        return _dummy_redis_store.get(name, set())
        
    def lpush(self, name, *values):
        if name not in _dummy_redis_store:
            _dummy_redis_store[name] = []
        for v in values:
            _dummy_redis_store[name].insert(0, v)
            
    def rpush(self, name, *values):
        if name not in _dummy_redis_store:
            _dummy_redis_store[name] = []
        _dummy_redis_store[name].extend(values)
        
    def lrange(self, name, start, end):
        lst = _dummy_redis_store.get(name, [])
        if end == -1:
            return lst[start:]
        return lst[start:end+1]
        
    def expire(self, *a, **k): return True
    def pipeline(self, *a, **k): return self
    def execute(self, *a, **k): return []

redis_mod = create_mock("redis",
    Redis=DummyRedisClass, Connection=DummyClass,
    from_url=lambda *a, **k: DummyRedisClass()
)
exc_mod = create_mock("redis.exceptions",
    BusyLoadingError=Exception, ConnectionError=Exception,
    ResponseError=Exception
)
redis_mod.exceptions = exc_mod
create_mock("redis.commands.search", Search=DummyClass)
create_mock("redis.commands", search=sys.modules["redis.commands.search"])

# ── RQ (Redis Queue) Mocks ──────────────────────────────────────────

class DummyDequeueStrategy:
    DEFAULT = None

rq_mod = create_mock("rq",
    Queue=DummyClass, Worker=DummyClass, Callback=DummyClass,
    get_current_job=lambda *a, **k: None
)
rq_mod.defaults = create_mock("rq.defaults", DEFAULT_WORKER_TTL=420)
rq_mod.exceptions = create_mock("rq.exceptions",
    InvalidJobOperation=Exception, NoSuchJobError=Exception
)
rq_mod.job = create_mock("rq.job", Job=DummyClass, JobStatus=DummyClass)
rq_mod.logutils = create_mock("rq.logutils",
    setup_loghandlers=lambda *a, **k: None
)
rq_mod.timeouts = create_mock("rq.timeouts", JobTimeoutException=Exception)
rq_mod.worker = create_mock("rq.worker",
    DequeueStrategy=DummyDequeueStrategy, StopRequested=Exception,
    WorkerStatus=DummyClass
)
rq_mod.worker_pool = create_mock("rq.worker_pool", WorkerPool=DummyClass)

# ── Telemetry Mock ──────────────────────────────────────────────────

create_mock("posthog", Posthog=DummyClass)

# ── Database Driver Mocks (bypassed — we use SQLite) ────────────────

db_exc = dict(
    Error=Exception, Warning=Exception, InterfaceError=Exception,
    DatabaseError=Exception, DataError=Exception, OperationalError=Exception,
    IntegrityError=Exception, InternalError=Exception, ProgrammingError=Exception,
    NotSupportedError=Exception,
)

create_mock("MySQLdb", **db_exc)
create_mock("MySQLdb._mysql", escape_string=lambda *a, **k: b"")
create_mock("MySQLdb.constants", ER=OmniMock, FIELD_TYPE=OmniMock)
create_mock("MySQLdb.converters", conversions={})
create_mock("MySQLdb.cursors", SSCursor=DummyClass)

create_mock("psycopg2", **db_exc)
create_mock("psycopg2.extensions", ISOLATION_LEVEL_REPEATABLE_READ=0)
create_mock("psycopg2.sql")
create_mock("psycopg2.errorcodes")
create_mock("psycopg2.errors")

# ── System Utility Mocks ────────────────────────────────────────────

create_mock("psutil")

# ── orjson Mock (Rust extension → standard json) ────────────────────

class MockOrjson:
    JSONDecodeError = json.JSONDecodeError
    OPT_NON_STR_KEYS = 1
    OPT_SERIALIZE_DATACLASS = 2
    OPT_INDENT_2 = 4
    OPT_APPEND_NEWLINE = 8
    OPT_PASSTHROUGH_DATETIME = 16
    OPT_UTC_Z = 32
    OPT_OMIT_MICROSECONDS = 64
    OPT_SORT_KEYS = 128

    @staticmethod
    def dumps(obj, default=None, option=None):
        return json.dumps(obj, default=default).encode("utf-8")

    @staticmethod
    def loads(obj):
        return json.loads(obj)

sys.modules["orjson"] = MockOrjson

# ── Site Configuration ──────────────────────────────────────────────

site_config = {
    "db_type": "sqlite",
    "db_name": "site1",
    "use_memory_cache": True,
    "developer_mode": 1,
    "ignore_csrf": 1,
}
with open("/home/pyodide/bench/sites/site1/site_config.json", "w") as f:
    json.dump(site_config, f)

# ── Environment Setup ───────────────────────────────────────────────


os.chdir("/home/pyodide/bench/sites")
os.environ["SITES_PATH"] = "/home/pyodide/bench/sites"
os.environ["FRAPPE_SITE"] = "site1"

# ── Boot Frappe ─────────────────────────────────────────────────────

import frappe
frappe.init(site="site1", sites_path="/home/pyodide/bench/sites")
frappe.connect()

# Cookie jar to persist session across requests (SW can't pass Set-Cookie headers)
_cookie_jar = {}
    `);

    self.postMessage({ type: "LOG", message: "Frappe booted successfully!" });
    self.postMessage({ type: "READY" });
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
                self.pyRequestPayload = req;
                const resultJson = await pyodide.runPythonAsync(`
import io, json, traceback, js, os

_req = js.self.pyRequestPayload

# Enforce correct working directory and environment per-request

os.chdir("/home/pyodide/bench/sites")
os.environ["SITES_PATH"] = "/home/pyodide/bench/sites"

# Re-init Frappe for this request context
import frappe

try:
    from frappe.app import application

    if _req.path == "/debug_cache":
        try:
            import inspect
            cc_dir = dir(frappe.client_cache)
            cc_type = type(frappe.client_cache).__name__
            with open("/home/pyodide/frappe_env/frappe/utils/redis_wrapper.py") as f:
                rw_code = "".join(f.readlines()[500:525])
        except Exception as e:
            cc_dir = str(e)
            cc_type = str(e)
            rw_code = str(e)
            
        _status = "200 OK"
        _headers = []
        body_parts = [f"ClientCache type: {cc_type}\\nDir: {cc_dir}\\nCode:\\n{rw_code}".encode("utf-8")]
    elif _req.path == "/debug_cookies":
        _status = "200 OK"
        _headers = []
        body_parts = [str(_cookie_jar).encode("utf-8")]
    elif _req.path == "/find_redis":
        try:
            with open("/home/pyodide/frappe_env/frappe/sessions.py", "r") as f:
                lines = f.readlines()[135:160]
            _status = "200 OK"
            _headers = []
            body_parts = ["".join(lines).encode("utf-8")]
        except Exception as e:
            _status = "500 Internal Server Error"
            _headers = []
            body_parts = [str(e).encode("utf-8")]
    else:
        # Build cookie header from jar + any browser-sent cookies
        _browser_cookies = str(_req.headers.to_py().get("cookie", "") or "")
        
        from http.cookies import SimpleCookie
        _parsed = SimpleCookie(_browser_cookies)
        for _k, _v in _cookie_jar.items():
            _parsed[_k] = _v
        _all_cookies = _parsed.output(header="", sep=";").strip()

        environ = {
            "REQUEST_METHOD": str(_req.method),
            "PATH_INFO": str(_req.path),
            "QUERY_STRING": str(getattr(_req, "query", "")),
            "SERVER_NAME": "site1",
            "SERVER_PORT": "80",
            "HTTP_HOST": "site1",
            "HTTP_COOKIE": _all_cookies,
            "CONTENT_TYPE": str(_req.headers.to_py().get("content-type", "") or "application/x-www-form-urlencoded"),
            "CONTENT_LENGTH": str(len(str(getattr(_req, "body", "") or ""))),
            "wsgi.version": (1, 0),
            "wsgi.url_scheme": "http",
            "wsgi.input": io.BytesIO(str(getattr(_req, "body", "") or "").encode("utf-8")),
            "wsgi.errors": io.StringIO(),
            "wsgi.multithread": False,
            "wsgi.multiprocess": False,
            "wsgi.run_once": False,
        }

        _status = "200 OK"
        _headers = []

        def start_response(status, headers, exc_info=None):
            global _status, _headers
            _status = status
            _headers = headers

        body_parts = application(environ, start_response)
    print("Application returned successfully.")
    body = b"".join(body_parts)

    # Extract Set-Cookie headers into the cookie jar (SW can't pass them through)
    _response_headers = {}
    for _hname, _hval in _headers:
        if _hname.lower() == "set-cookie":
            _cookie_part = _hval.split(";")[0]  # name=value, ignore attributes
            _cname, _, _cval = _cookie_part.partition("=")
            _cookie_jar[_cname.strip()] = _cval.strip()
        else:
            _response_headers[_hname] = _hval

    import json
    _response_json = json.dumps({
        "status": int(_status.split(" ")[0]),
        "headers": _response_headers,
        "body": body.decode("utf-8")
    })
    print("Result json dumped successfully.")
except Exception as e:
    import sys, os
    err = traceback.format_exc()
    
    # Try to grab some debugging context
    debug_info = []
    try:
        import frappe
        debug_info.append(f"CWD: {os.getcwd()}")
        debug_info.append(f"SITES_PATH: {os.environ.get('SITES_PATH')}")
        debug_info.append(f"local.sites_path: {getattr(frappe.local, 'sites_path', 'NOT_SET')}")
        debug_info.append(f"local.site: {getattr(frappe.local, 'site', 'NOT_SET')}")
        if hasattr(frappe.local, 'db') and frappe.local.db:
            debug_info.append(f"db_path: {getattr(frappe.local.db, 'db_path', 'NOT_SET')}")
    except Exception as inner_e:
        debug_info.append(f"Error getting debug info: {inner_e}")

    full_error = "DEBUG INFO:\\n" + "\\n".join(debug_info) + "\\n\\nTRACEBACK:\\n" + err

    print(full_error)
    _response_json = json.dumps({
        "status": 500,
        "headers": {"Content-Type": "text/plain"},
        "body": full_error,
    })
finally:
    frappe.destroy()

_response_json
                `);
                responsePort.postMessage(JSON.parse(resultJson));
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
