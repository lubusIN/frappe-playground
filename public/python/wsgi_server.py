import io
import traceback
import os
import sys
import mimetypes
import sqlite3
from http.cookies import SimpleCookie
import frappe
import frappe.auth
from frappe.app import application

class FrappeWSGIHandler:
    def __init__(self):
        self.bench_sites_path = os.environ.get("BENCH_SITES_PATH", "/home/pyodide/bench/sites")
        self.default_site = os.environ.get("FRAPPE_DEFAULT_SITE", "site1")
        self.initialize_environment()

    def get_site_db_path(self, site_name):
        return os.path.join(self.bench_sites_path, site_name, "db", f"{site_name}.db")

    def initialize_environment(self):
        """Bootstraps the Frappe environment when the worker starts."""
        os.chdir(self.bench_sites_path)
        os.environ["SITES_PATH"] = self.bench_sites_path
        os.environ["FRAPPE_SITE"] = self.default_site

        frappe.init(site=self.default_site, sites_path=self.bench_sites_path)
        frappe.connect()

        def bypass_csrf(*args, **kwargs): return True
        frappe.auth.validate_csrf_token = bypass_csrf

    def serve_static_file(self, req, site_name):
        """Serve a static file directly from Pyodide's MEMFS."""
        try:
            file_path = os.path.join(self.bench_sites_path, site_name, "public", req["path"].lstrip("/"))
            with open(file_path, "rb") as f:
                content = f.read()
            mime_type, _ = mimetypes.guess_type(file_path)
            return {
                "status": 200,
                "headers": [("Content-Type", mime_type or "application/octet-stream")],
                "body": content
            }
        except FileNotFoundError:
            print(f"WSGI Static 404: {file_path}")
            return {"status": 404, "headers": [], "body": b"File not found in MEMFS"}
        except Exception as e:
            tb = traceback.format_exc()
            print(f"WSGI Static 500 Exception: {tb}")
            return {"status": 500, "headers": [], "body": tb.encode("utf-8")}

    def build_wsgi_environ(self, req, site_name):
        """Constructs the WSGI environment dictionary from the JS request payload."""
        
        # We must properly format the browser-sent cookies alongside our Pyodide-internal cookie_jar
        _browser_cookies = req.get("headers", {}).get("cookie", "") or ""
        _parsed = SimpleCookie(_browser_cookies)
        
        global _cookie_jar
        for k, v in _cookie_jar.items():
            _parsed[k] = v
            
        _all_cookies = "; ".join(f"{k}={m.value}" for k, m in _parsed.items())

        environ = {
            "REQUEST_METHOD": req["method"],
            "PATH_INFO": req["path"],
            "QUERY_STRING": req.get("query", ""),
            "SERVER_NAME": site_name,
            "SERVER_PORT": "8000",
            "SERVER_PROTOCOL": "HTTP/1.1",
            "HTTP_HOST": site_name,
            "HTTP_COOKIE": _all_cookies,
            "wsgi.version": (1, 0),
            "wsgi.url_scheme": "http",
            "wsgi.errors": sys.stderr,
            "wsgi.multithread": False,
            "wsgi.multiprocess": False,
            "wsgi.run_once": False,
        }

        for k, v in req.get("headers", {}).items():
            key = "HTTP_" + k.replace("-", "_").upper()
            if key not in environ:
                environ[key] = str(v)

        # Ensure body data is correctly converted from JS proxies to Python bytes
        body_data = req.get("body", b"")
        if isinstance(body_data, str):
            body_data = body_data.encode("utf-8")
        elif hasattr(body_data, "to_py"):
            body_data = bytes(body_data.to_py())
        elif not isinstance(body_data, bytes):
            body_data = bytes(body_data)

        environ["wsgi.input"] = io.BytesIO(body_data)

        if req["method"] in ["POST", "PUT", "PATCH"]:
            environ["CONTENT_TYPE"] = str(req.get("headers", {}).get("content-type", "application/x-www-form-urlencoded"))
            environ["CONTENT_LENGTH"] = str(len(body_data))

        return environ

    def execute_frappe_app(self, environ):
        """Executes Frappe's WSGI application and returns the status, headers, and body."""
        _status = "500 Internal Server Error"
        _headers = []

        def start_response(status, response_headers, exc_info=None):
            nonlocal _status, _headers
            _status = status
            _headers = response_headers
            return lambda body_data: None

        req = {
            "path": environ.get("PATH_INFO", ""),
        }
        body_parts = []
        try:
            result_iter = application(environ, start_response)
            
            # Extract returned Set-Cookie headers into the global cookie jar for persistence across reloads
            global _cookie_jar
            for k, v in _headers:
                if k.lower() == "set-cookie":
                    parts = v.split(";")
                    if parts:
                        kv = parts[0].split("=", 1)
                        if len(kv) == 2:
                            _cookie_jar[kv[0].strip()] = kv[1].strip()

            # Pyodide cannot return generator/iterable wrappers across the JS boundary easily,
            # so we must exhaust the WSGI iterable and join the byte chunks manually here.
            for chunk in result_iter:
                body_parts.append(chunk)

            if hasattr(result_iter, "close"):
                result_iter.close()

            # 4. Check for critical lifecycle hooks BEFORE destroying Frappe context
            self.handle_setup_wizard_completion(req, _status, environ["SERVER_NAME"])

        except Exception as e:
            tb = traceback.format_exc()
            print("WSGI Exception:", tb)
            _status = "500 Internal Server Error"
            _headers = [("Content-Type", "text/plain")]
            body_parts = [tb.encode("utf-8")]
        finally:
            frappe.destroy()

        return _status, _headers, b"".join(body_parts)

    def handle_setup_wizard_completion(self, req, status, site_name):
        """Persists Frappe setup state securely to SQLite when the setup wizard finishes."""
        if req["path"] == "/api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete" and status.startswith("2"):
            # Frappe marks the app setup-complete after its own setup commit.
            # We manually update these flags in SQLite before the redirect to /desk to ensure
            # the persistent IDB backup captures the complete state in Pyodide.
            conn = sqlite3.connect(self.get_site_db_path(site_name))
            try:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("update 'tabInstalled Application' set is_setup_complete=1 where app_name='frappe'")
                conn.execute("update tabSingles set value='1' where doctype='System Settings' and field='setup_complete'")
                conn.execute("update tabDefaultValue set defvalue='workspace' where parent='__default' and defkey='desktop:home_page'")
                conn.commit()
            finally:
                conn.close()

    def handle_request(self, req):
        """Main WSGI entrypoint from the Pyodide/JS bridge."""
        if hasattr(req, "to_py"):
            req = req.to_py()
            
        site_name = req.get("site", self.default_site)

        # 1. Handle Static Files
        if req["path"].startswith("/files/"):
            return self.serve_static_file(req, site_name)

        # 2. Re-init Frappe environment variables per request
        os.chdir(self.bench_sites_path)
        os.environ["SITES_PATH"] = self.bench_sites_path
        os.environ["FRAPPE_SITE"] = site_name

        # 3. Build Environment & Execute
        environ = self.build_wsgi_environ(req, site_name)
        _status, _headers, body_bytes = self.execute_frappe_app(environ)

        # 4. Return JSON-serializable response to Javascript
        try:
            status_code = int(_status.split(" ")[0])
        except (ValueError, IndexError):
            print(f"WSGI Warning: Invalid status string '{_status}', defaulting to 500.")
            status_code = 500
            
        if status_code >= 500:
            print(f"WSGI 500 Error Body for {req['path']}: {body_bytes.decode('utf-8', errors='replace')}")
            
        return {
            "status": status_code,
            "headers": _headers,
            "body": body_bytes
        }

_cookie_jar = {}

# Instantiate the global handler
_handler = FrappeWSGIHandler()

# Expose the top-level function for JS interop
def handle_request(req):
    return _handler.handle_request(req)
