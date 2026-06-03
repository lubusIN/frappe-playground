// ──────────────────────────────────────────────────────────────────────────────
// Frappe Playground — Configuration Constants
// ──────────────────────────────────────────────────────────────────────────────

export const SITE_CONFIG = {
    db_type: "sqlite",
    db_name: "site1",
    developer_mode: 1,
    ignore_csrf: 1,
    enable_telemetry: 0,
    pause_scheduler: 1,
    disable_async: 1,
    trigger_site_setup_in_background: 0
};

export const BENCH_DIRECTORIES = [
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
    "/home/pyodide/logs"
];

export const PYTHON_PACKAGES = [
    "RestrictedPython",
    "filetype",
    "filelock",
    "pypdf",
    "passlib",
    "markdown2",
    "bleach",
    "bleach-allowlist",
    "croniter",
    "cssutils",
    "email-reply-parser",
    "pydantic",
    "sqlparse",
    "sql_metadata",
    "terminaltables",
    "traceback-with-variables",
    "typing_extensions",
    "xlrd",
    "zxcvbn",
    "markdownify",
    "PyJWT",
    "semantic-version",
    "chardet",
    "html5lib",
    "oauthlib",
    "openpyxl",
    "xlsxwriter",
    "phonenumbers",
    "premailer",
    "pyotp",
    "requests-oauthlib",
    "rsa",
    "sentry-sdk",
    "tenacity",
    "Pillow",
    "pytz",
    "requests",
    "urllib3",
    "nh3",
    "Babel",
    "MarkupSafe",
    "PyYAML",
    "beautifulsoup4",
    "python-dateutil",
    "pdfkit",
    "PyMySQL",
    "whoosh"
];


