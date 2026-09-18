# Python and Frappe runtime

The runtime build converts a normal Frappe source tree into assets that Pyodide can install and execute in a browser worker.

## Checked version

The current repository pins Frappe **16.30.0** in `runtime/frappe-version.json`. `runtime/build/Dockerfile`, build scripts, tests, and the [compatibility notes](/development/upstream-notes) are checked against that declaration.

## Filesystem layout

The worker assembles a small Bench-shaped tree below `/home/pyodide`:

```text
/home/pyodide/
├── frappe_env/                 # prepared Python packages and app code
└── bench/sites/
    ├── apps.txt
    ├── assets/assets.json
    ├── currentsite.txt
    └── site1/
        ├── site_config.json
        ├── db/site1.db
        ├── public/files/
        └── private/files/
```

Frappe always sees `site1` and SQLite. The Service Worker supplies the corresponding site header and translates virtual host URLs.

## Python boot

`packages/server/src/boot.js` loads Pyodide from the pinned jsDelivr path `pyodide/v314.0.0/full/`, preloads `micropip`, `cryptography`, and `tzdata`, then installs `runtime/config/packages.js` dependencies with `micropip` and `keep_going`. `filesystem.js` fetches the asset manifest and prepared archive, then writes or restores the environment. Authored Python files are converted to a generated JavaScript source module by `scripts/generate-python-sources.mjs`, keeping worker imports static and deployable.

`runtime/python/wsgi_server.py` adapts request envelopes to Frappe’s WSGI application and exports responses plus cookie state. It serves uploaded `/files/` content only from the site’s resolved public directory and rejects traversal outside that root. It exhausts WSGI iterables inside Python because generator wrappers cannot safely cross the JS boundary. `request-handler.js` owns the JavaScript bridge, destroys temporary PyProxy objects, and serializes execution.

The synthetic WSGI environment reports `site1`, port `8000`, HTTP scheme, and single-threaded/single-process execution. Incoming browser cookies are merged with the worker’s internal cookie jar. Returned `Set-Cookie` values update that jar; only the current non-sensitive Frappe UI identity is passed to the HTML compatibility layer for `document.cookie` behavior.

## Browser compatibility layer

Frappe assumes infrastructure and native packages unavailable in Pyodide. The current compatibility layer includes:

- selected MariaDB SQL constructs and date/time functions translated for SQLite, including `DATE_ADD`/`DATE_SUB`, `IF`, `TIMESTAMPDIFF`, `ON DUPLICATE KEY UPDATE`, and selected union/constraint behavior;
- a functional in-process fake Redis server for cache and session paths;
- import-compatible RQ symbols while async work is disabled;
- standard-library-backed substitutes for selected native modules such as `orjson`;
- limited process information for `psutil`; and
- inert import guards for selected optional integrations.

These shims support the repository’s checked boot and application flows; they are not full implementations. Inert mocks can hide unsupported feature execution, so new code should prefer explicit minimal substitutes and clear errors.

The [compatibility and upstream notes](/development/upstream-notes) are the detailed compatibility inventory: they separate required boot-path substitutes, feature-path guards, unproven historical mocks, upstream Frappe constraints, and mock-removal risks. Keep that evidence-oriented inventory more granular than this architectural overview.

## Site configuration

The generated site config currently sets:

```js
{
  db_type: 'sqlite',
  db_name: 'site1',
  developer_mode: 1,
  ignore_csrf: 1,
  enable_telemetry: 0,
  pause_scheduler: 1,
  disable_async: 1,
  login_with_email_link: 0,
  trigger_site_setup_in_background: 0,
}
```

This is a deliberately constrained browser profile. Review [Limits and browser support](/guide/limitations) before evaluating an app against it.
