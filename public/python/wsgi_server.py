import io, json, traceback, os
import frappe
from frappe.app import application

def handle_request(req):
    """
    Simulates a WSGI environment, calls the Frappe application, 
    and returns a serialized Response dictionary.
    """
    global _cookie_jar
    
    # 1. Debug Routes Interceptor
    if req["path"] == "/debug_cache":
        try:
            import inspect
            cc_dir = dir(frappe.client_cache)
            cc_type = type(frappe.client_cache).__name__
            with open("/home/pyodide/frappe_env/frappe/utils/redis_wrapper.py") as f:
                wrapper_src = f.read()
            body_parts = [json.dumps({"type": cc_type, "dir": cc_dir, "src_len": len(wrapper_src)}).encode("utf-8")]
            return {"status": "200 OK", "headers": [], "body": b"".join(body_parts)}
        except Exception as e:
            return {"status": "500 Internal Server Error", "headers": [], "body": str(e).encode("utf-8")}
            
    elif req["path"] == "/debug_cookies":
        try:
            return {"status": "200 OK", "headers": [], "body": str(_cookie_jar).encode("utf-8")}
        except NameError:
            return {"status": "200 OK", "headers": [], "body": b"Cookie jar not initialized."}
            
    elif req["path"] == "/find_redis":
        try:
            with open("/home/pyodide/frappe_env/frappe/sessions.py", "r") as f:
                lines = f.readlines()[135:160]
            return {"status": "200 OK", "headers": [], "body": "".join(lines).encode("utf-8")}
        except Exception as e:
            return {"status": "500 Internal Server Error", "headers": [], "body": str(e).encode("utf-8")}

    # 2. Re-init Frappe environment variables per request
    os.chdir("/home/pyodide/bench/sites")
    os.environ["SITES_PATH"] = "/home/pyodide/bench/sites"
    os.environ["FRAPPE_SITE"] = "site1"

    # 3. Build WSGI Environment Dictionary
    # We must properly format the browser-sent cookies alongside our _cookie_jar
    _browser_cookies = req["headers"].get("cookie", "") or ""
    
    from http.cookies import SimpleCookie
    _parsed = SimpleCookie(_browser_cookies)
    
    if '_cookie_jar' not in globals():
        _cookie_jar = {}
        
    for k, v in _cookie_jar.items():
        _parsed[k] = v
        
    _all_cookies = "; ".join(f"{k}={m.value}" for k, m in _parsed.items())

    environ = {
        "REQUEST_METHOD": req["method"],
        "PATH_INFO": req["path"],
        "QUERY_STRING": req.get("query", ""),
        "SERVER_NAME": "site1",
        "SERVER_PORT": "8000",
        "SERVER_PROTOCOL": "HTTP/1.1",
        "HTTP_HOST": "site1",
        "HTTP_COOKIE": _all_cookies,
        "wsgi.version": (1, 0),
        "wsgi.url_scheme": "http",
        "wsgi.input": io.BytesIO(req.get("body", "").encode("utf-8")),
        "wsgi.errors": sys.stderr,
        "wsgi.multithread": False,
        "wsgi.multiprocess": False,
        "wsgi.run_once": False,
    }

    for k, v in req["headers"].items():
        key = "HTTP_" + k.replace("-", "_").upper()
        if key not in environ:
            environ[key] = str(v)

    if req["method"] in ["POST", "PUT", "PATCH"]:
        environ["CONTENT_TYPE"] = str(req["headers"].get("content-type", "application/x-www-form-urlencoded"))
        environ["CONTENT_LENGTH"] = str(len(req.get("body", "")))

    _status = "500 Internal Server Error"
    _headers = []

    def start_response(status, response_headers, exc_info=None):
        nonlocal _status, _headers
        _status = status
        _headers = response_headers
        return lambda body_data: None

    # 4. Execute the WSGI Application
    try:
        result_iter = application(environ, start_response)
        
        # Extract returned Set-Cookie headers into the global cookie jar for persistence
        for k, v in _headers:
            if k.lower() == "set-cookie":
                parts = v.split(";")
                if parts:
                    kv = parts[0].split("=", 1)
                    if len(kv) == 2:
                        _cookie_jar[kv[0].strip()] = kv[1].strip()

        # Pyodide cannot return generator/iterable wrappers across the JS boundary easily,
        # so we exhaust the iterable and join the chunks here.
        body_parts = []
        for chunk in result_iter:
            body_parts.append(chunk)

        if hasattr(result_iter, "close"):
            result_iter.close()

    except Exception as e:
        tb = traceback.format_exc()
        print("WSGI Exception:", tb)
        _status = "500 Internal Server Error"
        _headers = [("Content-Type", "text/plain")]
        body_parts = [tb.encode("utf-8")]
    finally:
        frappe.destroy()

    # 5. Return JSON-serializable response to Javascript
    status_code = int(_status.split(" ")[0])
    try:
        body_bytes = b"".join(body_parts)
    except Exception:
        body_bytes = b""
        
    if status_code >= 500:
        print(f"WSGI 500 Error Body for {req['path']}: {body_bytes.decode('utf-8', errors='replace')}")
        
    return {
        "status": status_code,
        "headers": _headers,
        "body": body_bytes
    }

# ──────────────────────────────────────────────────────────────────────────────
# 5. Initialize Frappe Environment for WASM
# ──────────────────────────────────────────────────────────────────────────────
import json
import warnings
warnings.filterwarnings("ignore", category=SyntaxWarning, module=r"whoosh\\..*")
warnings.filterwarnings("ignore", category=DeprecationWarning, module=r"whoosh\\..*")

os.chdir("/home/pyodide/bench/sites")
os.environ["SITES_PATH"] = "/home/pyodide/bench/sites"
os.environ["FRAPPE_SITE"] = "site1"

import frappe
frappe.init(site="site1", sites_path="/home/pyodide/bench/sites")
frappe.connect()

import frappe.auth
def bypass_csrf(*args, **kwargs): return True
frappe.auth.validate_csrf_token = bypass_csrf
