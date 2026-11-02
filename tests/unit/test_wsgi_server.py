"""Unit tests for Frappe WSGI server."""

import io
import os
import sys
import tempfile
import types
import unittest
from unittest.mock import MagicMock, patch

# Mock frappe dependencies before importing wsgi_server
mock_frappe = types.ModuleType("frappe")
mock_frappe.init = MagicMock()
mock_frappe.connect = MagicMock()
mock_frappe.destroy = MagicMock()
mock_frappe.clear_cache = MagicMock()
mock_frappe.conf = {}
mock_frappe.db = types.SimpleNamespace(commit=MagicMock())
mock_frappe.session = types.SimpleNamespace(user="Guest")

mock_auth = types.ModuleType("frappe.auth")
mock_auth.validate_csrf_token = MagicMock()

mock_app = types.ModuleType("frappe.app")
mock_app.application = MagicMock()

mock_cache_mgr = types.ModuleType("frappe.cache_manager")
mock_cache_mgr.clear_controller_cache = MagicMock()

sys.modules["frappe"] = mock_frappe
sys.modules["frappe.auth"] = mock_auth
sys.modules["frappe.app"] = mock_app
sys.modules["frappe.cache_manager"] = mock_cache_mgr

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "runtime", "python"))

import wsgi_server  # noqa: E402
from wsgi_server import FrappeWSGIHandler  # noqa: E402


class WSGIServerTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.bench_sites_path = self.temp_dir.name
        self.site_name = "site1"
        self.site_dir = os.path.join(self.bench_sites_path, self.site_name)
        self.public_dir = os.path.join(self.site_dir, "public")
        self.files_dir = os.path.join(self.public_dir, "files")
        os.makedirs(self.files_dir, exist_ok=True)

        mock_frappe.init.reset_mock()
        mock_frappe.connect.reset_mock()
        mock_frappe.destroy.reset_mock()
        mock_frappe.conf = {}
        mock_frappe.session.user = "Guest"

        self.handler = FrappeWSGIHandler.__new__(FrappeWSGIHandler)
        self.handler.bench_sites_path = self.bench_sites_path
        self.handler.default_site = self.site_name
        self.handler.cookie_jar = {}

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_get_site_db_path(self):
        expected = os.path.join(self.bench_sites_path, "site1", "db", "site1.db")
        self.assertEqual(self.handler.get_site_db_path("site1"), expected)

    def test_build_wsgi_environ_basic(self):
        req = {
            "method": "GET",
            "path": "/api/method/ping",
            "query": "foo=bar",
            "headers": {
                "user-agent": "test-agent",
                "cookie": "sid=browser-cookie",
            },
        }
        self.handler.cookie_jar = {"custom_cookie": "internal-value"}

        environ = self.handler.build_wsgi_environ(req, "site1")

        self.assertEqual(environ["REQUEST_METHOD"], "GET")
        self.assertEqual(environ["PATH_INFO"], "/api/method/ping")
        self.assertEqual(environ["QUERY_STRING"], "foo=bar")
        self.assertEqual(environ["SERVER_NAME"], "site1")
        self.assertEqual(environ["HTTP_HOST"], "site1")
        self.assertEqual(environ["HTTP_USER_AGENT"], "test-agent")
        self.assertIn("sid=browser-cookie", environ["HTTP_COOKIE"])
        self.assertIn("custom_cookie=internal-value", environ["HTTP_COOKIE"])
        self.assertIsInstance(environ["wsgi.input"], io.BytesIO)

    def test_build_wsgi_environ_unquotes_path_info(self):
        req = {
            "method": "GET",
            "path": "/api/v2/document/Wiki%20Space",
            "query": "limit=10",
            "headers": {},
        }
        environ = self.handler.build_wsgi_environ(req, "site1")
        self.assertEqual(environ["PATH_INFO"], "/api/v2/document/Wiki Space")
        self.assertEqual(environ["RAW_URI"], "/api/v2/document/Wiki%20Space?limit=10")
        self.assertEqual(environ["REQUEST_URI"], "/api/v2/document/Wiki%20Space?limit=10")

    def test_build_wsgi_environ_post_body(self):
        body_text = '{"name": "test"}'
        req = {
            "method": "POST",
            "path": "/api/resource/Doc",
            "headers": {
                "content-type": "application/json",
            },
            "body": body_text,
        }
        environ = self.handler.build_wsgi_environ(req, "site1")

        self.assertEqual(environ["REQUEST_METHOD"], "POST")
        self.assertEqual(environ["CONTENT_TYPE"], "application/json")
        self.assertEqual(environ["CONTENT_LENGTH"], str(len(body_text.encode("utf-8"))))
        self.assertEqual(environ["wsgi.input"].read(), body_text.encode("utf-8"))

    def test_build_wsgi_environ_proxy_body(self):
        class FakePyProxy:
            def to_py(self):
                return b"proxy-bytes"

        req = {
            "method": "PUT",
            "path": "/api/resource/Doc/1",
            "body": FakePyProxy(),
        }
        environ = self.handler.build_wsgi_environ(req, "site1")
        self.assertEqual(environ["wsgi.input"].read(), b"proxy-bytes")

    def test_serve_static_file_success(self):
        test_file = os.path.join(self.files_dir, "test.txt")
        with open(test_file, "wb") as f:
            f.write(b"hello world")

        req = {"path": "/files/test.txt"}
        res = self.handler.serve_static_file(req, self.site_name)

        self.assertEqual(res["status"], 200)
        self.assertEqual(res["body"], b"hello world")
        self.assertTrue(any(k == "Content-Type" and "text/plain" in v for k, v in res["headers"]))

    @patch("builtins.print")
    def test_serve_static_file_not_found(self, _mock_print):
        req = {"path": "/files/missing.txt"}
        res = self.handler.serve_static_file(req, self.site_name)
        self.assertEqual(res["status"], 404)
        self.assertEqual(res["body"], b"File not found in MEMFS")

    def test_serve_static_file_path_traversal_forbidden(self):
        req = {"path": "/files/../../secret.txt"}
        res = self.handler.serve_static_file(req, self.site_name)
        self.assertEqual(res["status"], 403)
        self.assertEqual(res["body"], b"Forbidden")

    def test_execute_frappe_app_success(self):
        def fake_app(environ, start_response):
            start_response("200 OK", [
                ("Content-Type", "text/plain"),
                ("Set-Cookie", "user_id=Administrator; Path=/; HttpOnly"),
            ])
            return [b"chunk1", b"chunk2"]

        mock_frappe.session.user = "Administrator"

        environ = {
            "PATH_INFO": "/api/method/ping",
            "SERVER_NAME": "site1",
        }
        with patch("wsgi_server.application", side_effect=fake_app):
            status, headers, body = self.handler.execute_frappe_app(environ)

        self.assertEqual(status, "200 OK")
        self.assertEqual(body, b"chunk1chunk2")
        self.assertEqual(self.handler.cookie_jar.get("user_id"), "Administrator")
        self.assertTrue(any(k == "X-Playground-User-Id" and v == "Administrator" for k, v in headers))
        mock_frappe.destroy.assert_called_once()

    def test_handle_setup_wizard_completion(self):
        with patch("site_ops.mark_setup_complete") as mock_mark:
            req = {"path": "/api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete"}
            self.handler.handle_setup_wizard_completion(req, "200 OK", "site1")
            mock_mark.assert_called_once_with(self.handler.get_site_db_path("site1"))

        with patch("site_ops.mark_setup_complete") as mock_mark:
            # Different route must not trigger mark_setup_complete
            req = {"path": "/api/method/ping"}
            self.handler.handle_setup_wizard_completion(req, "200 OK", "site1")
            mock_mark.assert_not_called()

        with patch("site_ops.mark_setup_complete") as mock_mark:
            # Failed setup completion must not trigger mark_setup_complete
            req = {"path": "/api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete"}
            self.handler.handle_setup_wizard_completion(req, "500 Internal Server Error", "site1")
            mock_mark.assert_not_called()

    def test_handle_request_routes_static(self):
        test_file = os.path.join(self.files_dir, "image.png")
        with open(test_file, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n")

        req = {"path": "/files/image.png", "site": "site1"}
        res = self.handler.handle_request(req)
        self.assertEqual(res["status"], 200)
        self.assertEqual(res["body"], b"\x89PNG\r\n\x1a\n")

    def test_handle_request_routes_dynamic(self):
        def fake_app(environ, start_response):
            start_response("200 OK", [("Content-Type", "application/json")])
            return [b'{"message": "pong"}']

        req = {
            "path": "/api/method/ping",
            "method": "GET",
            "site": "site1",
        }
        with patch("wsgi_server.application", side_effect=fake_app):
            res = self.handler.handle_request(req)
        self.assertEqual(res["status"], 200)
        self.assertEqual(res["body"], b'{"message": "pong"}')


if __name__ == "__main__":
    unittest.main()
