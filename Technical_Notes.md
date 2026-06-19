# Upstream Notes

## Purpose

This document records Frappe-specific observations that may be useful for
upstream improvements. They come from running Frappe Framework inside Pyodide
with SQLite, without external Redis, RQ workers, or Socket.IO.

It is a technical reference rather than a ready-to-file issue. Each upstream
report should still be reduced to one independently reproducible behavior.

Browser platform requirements such as Service Worker routing, IndexedDB storage,
cross-origin isolation headers, and per-tab URL scoping are intentionally excluded
unless they expose a concrete Frappe integration constraint.

## Reference Scope

- The generated runtime currently contains **Frappe 16.23.0**.
- `Dockerfile.build` builds from a pinned tag (`v16.23.0`) via a build argument. These notes therefore describe the checked runtime artifact, not every
  version of Frappe 16.
- Local behavior is covered by the repository's Playwright flows, including
  boot, login, Setup Wizard, Desk, file upload, and scoped reloads.

## Pointers

Short list for an upstream GitHub issue:

### Issue 1: Eager MariaDB backend imports during SQLite runtime execution

**Problem:** Even when `db_type` is configured as `"sqlite"`, `frappe.app` and related database initialization modules eagerly perform top-level imports of `frappe.database.mariadb` dependencies, which ultimately require the native compiled `mysqlclient` C extension.

**Impact:** Prevents Frappe from booting in environments where only SQLite is supported or where `mysqlclient` cannot be compiled (e.g., pure WebAssembly/Pyodide environments).

**Suggested Remedy:** Refactor database backend resolution to use lazy loading (`importlib.import_module`) based on the site configuration's active `db_type`.

---

### Issue 2: Top-level `rq` imports in `background_jobs` bypass disabled async configuration

**Problem:** In `frappe/utils/background_jobs.py`, classes like `Queue`, `Worker`, and `Job` from the `rq` package are imported at the module level. Setting `is_async=False` only changes runtime routing, not import-time requirements.

**Impact:** Codebases attempting to run Frappe in a single-threaded synchronous environment without Redis Queue dependencies crash at module-load time.

**Suggested Remedy:** Move `rq` package references inside the functional blocks that execute actual async dispatching, or wrap them in an abstraction layer.

---

### Issue 3: Cache and Session initialization enforce hard dependency on Redis

**Problem:** Core state mechanisms (`frappe.cache()`, session tracking, and global locks) assume a live, network-reachable Redis broker during basic system startup, even if background processing and webhooks are disabled.

**Impact:** Prevents minimal, isolated system boot or serverless execution contexts that require in-memory or alternative fallback state engines.

**Suggested Remedy:** Introduce an optional, native in-memory provider class for `frappe.cache` when explicitly configured for standalone/lightweight environments.

---

### Issue 4: Telemetry facade eagerly imports `posthog` provider

**Problem:** The telemetry orchestration layer imports the external `posthog` package globally at the top of the file before evaluating the runtime flag to check whether telemetry is enabled by the user.

**Impact:** Requires `posthog` to be present in the Python site-packages environment even if telemetry is fully deactivated.

**Suggested Remedy:** Defer the `import posthog` statement to live lazily inside the internal initialization block that satisfies `if telemetry_enabled:`.

---

### Issue 5: Hard requirement on native compiled packages (`orjson`, `psutil`) lacking fallback

**Problem:** Deep integration of `orjson` (for high-performance serialization) and `psutil` (for system metrics) occurs without standard library fallbacks (`json`) or mocking frameworks for environments missing process tree APIs.

**Impact:** Immediate runtime crashes on platforms without native compilation toolchains or operating system hooks (like browser sandboxes).

**Suggested Remedy:** Implement generic conditional `try/except` blocks falling back to Python's built-in `json` module and stubbed/empty dict metrics for process tracking.

---

### Issue 6: Hardcoded Realtime (Socket.IO) client initialization in Desk

**Problem:** The Desk application client (`desk.js` and boot pipelines) initializes the Socket.IO runtime instance by default. There is currently no option to gracefully bypass this connection pool.

**Impact:** In setups without a node real-time proxy, the browser console experiences continuous, non-breaking but disruptive connection polling/retry failures.

**Suggested Remedy:** Support a `frappe.boot.disable_realtime` flag passed from the backend context to cleanly skip Socket.IO initialization on the client side.

---

### Issue 7: Absolute, origin-root assumptions prevent subdirectory deployment

**Problem:** Internal routing engines, asset resolution strings (`/assets/...`), internal API endpoints, and Socket.IO handshakes are hardcoded to rely on root-relative URL paths.

**Impact:** Frappe applications fail to resolve assets and break functionality when reverse-proxied or mounted below a URL prefix path (e.g., `example.com/myapp/`).

**Suggested Remedy:** Refactor asset routing pipelines and internal JavaScript fetch actions to reference relative paths or follow a dynamic base URI variable (`frappe.base_url`).

---

### Issue 8: Runtime-loaded client modules bypass the central asset manifest

**Problem:** While `bench build` produces a standard asset manifest mapping version fingerprints, specific legacy modules and dynamic script split paths pull dependencies natively from paths under `/assets/frappe/node_modules/...`.

**Impact:** Breaks progressive build pipelines, immutable static hosting deployments, and compilation configurations where every single client-side asset footprint must be explicitly declared ahead of time.

**Suggested Remedy:** Ensure all client-facing dependencies are strictly declared, bundled, and versioned inside the master asset manifest artifact during the `bench build` step.

## Module Mocking Inventory

`public/python/frappe_mocks.py` modifies Python imports before loading Frappe.
The mocks do not all mean the same thing:

- some provide working local substitutes for services Frappe actively uses;
- some only satisfy import-time symbols;
- some disable optional integrations by returning inert objects; and
- some have no demonstrated use in the checked runtime.

The presence of a mock is not, by itself, evidence of an upstream defect.

### Required by the checked boot and request path

#### Redis

This is a functional substitute rather than a simple module stub. The playground
installs `fakeredis`, replaces the Redis client classes, shares one in-memory
server, and patches connection callback, pub/sub thread, `INFO`, and search APIs.

The substitute is exercised by:

- `frappe.init()`, which sets up Redis-backed cache clients;
- session boot and session persistence;
- cache and client-cache operations; and
- realtime publishing.

Upstream relevance:

- Frappe has no general no-Redis mode for this path.
- `pause_scheduler` and `disable_async` do not disable cache or session use of
  Redis.
- An in-process cache provider would reduce the largest local service mock.

#### RQ

The playground creates `rq` and these submodules:

- `rq.defaults`
- `rq.exceptions`
- `rq.job`
- `rq.logutils`
- `rq.timeouts`
- `rq.worker`
- `rq.worker_pool`
- `rq.command`
- `rq.queue`

The mock includes queue, job, status, callback, worker, and timeout symbols.
`frappe.app` preloads `frappe.utils.background_jobs`, which imports these symbols
at module load time even when `disable_async` is enabled.

The dummy queue reports jobs as immediately finished. This is sufficient for
selected synchronous playground flows, but it is not equivalent to RQ.

Upstream relevance:

- Move worker-only imports behind the operations that need them.
- Consider a documented synchronous queue adapter instead of requiring
  downstream code to imitate RQ's module structure.

#### MySQLdb

The playground creates:

- `MySQLdb`
- `MySQLdb._mysql`
- `MySQLdb.constants`
- `MySQLdb.converters`
- `MySQLdb.cursors`

It supplies database exception classes, `escape_string`, constant tables,
converter mappings, and a cursor class. This is needed because `frappe.app`
explicitly preloads `frappe.database.mariadb.mysqlclient`, even though the active
site uses SQLite.

This is the clearest database-driver portability finding. Frappe's normal
`get_db()` selection is already backend-aware; the issue is the web application's
MariaDB-specific preload.

Upstream relevance:

- Make the database preload conditional on `db_type`.
- Add an import test proving that `frappe.app` can load for SQLite without
  MySQLdb installed.

#### orjson

The playground registers an `orjson` replacement backed by standard-library
`json`. It implements the exception, option constants, `dumps()`, and `loads()`
needed by the checked flows.

`orjson` is imported directly by `frappe/__init__.py`, `frappe/app.py`, response
handling, safe execution, data utilities, and import utilities. Frappe therefore
cannot be imported without it.

The substitute is intentionally incomplete: option flags are declared but not
fully reproduced by `dumps()`.

Upstream relevance:

- Route serialization through a Frappe-owned adapter.
- Permit a documented slower fallback where native extensions are unavailable.

#### psutil

The playground supplies `psutil.Process`, `AccessDenied`, and `NoSuchProcess`.
Frappe imports `psutil` from `frappe/_optimizations.py`, and that module is loaded
while `import frappe` completes.

Most process-specific behavior is avoided because the relevant optimization
environment variables are not enabled. The module must still be importable.

Upstream relevance:

- Load `psutil` only when a process optimization or process-inspection operation
  is actually enabled.

#### PostHog

`posthog` is intercepted by the generic auto-mocker. This module is reached by
core flows: `frappe.utils.telemetry.__init__` eagerly imports its PostHog
provider, while boot and Setup Wizard import the telemetry package even when
telemetry is disabled.

`posthog` is not installed by the playground package list, so the import shim is
needed for those flows. Telemetry calls then become inert.

Upstream relevance:

- Import telemetry providers lazily after checking whether the provider is
  configured and enabled.
- A disabled provider should not need its client package merely to import the
  telemetry facade.

### Feature-path compatibility mocks

The auto-mocker also intercepts:

- `google` and `googleapiclient`
- `ldap3`
- `sentry_sdk`

Google and LDAP imports exist in their corresponding Frappe integration modules,
but those modules are not required for ordinary boot. Their mocks allow an
integration module to import if a hook, DocType, or route reaches it. The actual
integration cannot work because calls are absorbed.

`sentry-sdk` is already installed by `public/config.js`, but the auto-mocker
shadows it. Frappe's web setup imports Sentry only when related environment
variables are configured; error-reporting helpers can also import it on demand.
The reason for overriding the installed package has not been demonstrated.

These mocks should be treated as disabled-feature guards, not as confirmed
upstream requirements.

Upstream relevance:

- Optional integration modules should remain lazy and provide a clear
  "dependency not installed" error when invoked.
- Returning inert objects is useful for experimentation but can hide accidental
  feature execution.

### Mocks not shown to be needed

The checked Frappe source does not establish a SQLite boot-path requirement for:

- `psycopg2` and its submodules, which belong to the Postgres backend;
- `pwd` and `grp`, for which no imports were found in the bundled Frappe source;
- `twilio`;
- `boto3` and `botocore`;
- `dropbox`;
- `braintree`;
- `stripe`; or
- `plaid`.

The vendor names above also have no direct import references in the bundled
Frappe package. They may be historical defensive mocks or intended for code
outside the current runtime.

These entries should be tested for removal locally. They should not be cited as
Frappe dependencies without a failing import or executable reproduction.

### Mocking risks

`AbsorbingMock` returns another inert object for nearly every operation. This
keeps imports moving, but it can convert unsupported behavior into an apparent
success. The generic import finder also mocks every submodule below each listed
prefix, which makes accidental feature use difficult to detect.

The final fallback that registers a fake `frappe` module when Frappe cannot be
found is not a useful compatibility layer. A missing Frappe archive should fail
immediately with a clear boot error.

Local cleanup should prefer:

1. explicit, minimal mocks for imports proven necessary;
2. exceptions when a disabled integration is actually invoked;
3. removal tests for unreferenced mocks; and
4. a hard failure when the real `frappe` package is unavailable.

## Other Confirmed Observations

### Desk starts a Socket.IO client as part of normal boot

Frappe's Desk bundle imports `frappe/socketio_client.js`, and `frappe/desk.js`
calls `frappe.realtime.init()`. The playground has no Socket.IO backend, so its
Service Worker returns a minimal Engine.IO-compatible handshake and suppresses
follow-up polling failures.

This is a confirmed Desk assumption, although the protocol mock is specific to
the playground.

Potential portability improvement:

- Expose a boot flag that prevents realtime client initialization when realtime
  is intentionally unavailable.
- Keep existing realtime behavior as the default.

### Frappe URLs assume deployment at the origin root

The checked runtime does not expose a consistent application base-path setting
for mounting one Frappe site below a URL prefix such as:

```text
/instances/<scope>/
```

Frappe server and client code commonly emits or requests root-relative paths,
including:

- `/desk` and `/app`
- `/login`
- `/api/...`
- `/assets/...`
- `/files/...`
- `/socket.io/...`

Redirect responses preserve these root-relative locations. Frappe's
`frappe.utils.get_url()` can use a configured host name, but many callers pass a
URI beginning with `/`. Standard `urljoin()` behavior then replaces any path
already present in the configured host URL rather than preserving it. A host
name such as `https://example.test/instances/abc` therefore does not provide
general subfolder support.

This affects the playground because each browser tab owns a separate Frappe
runtime. Ideally, its scope could be encoded structurally:

```text
/instances/abc/desk
/instances/xyz/desk
```

Instead, the playground appends `?__scope=<id>` to the iframe URL. The Service
Worker then:

- reads scope from the query string or client mapping;
- removes `__scope` before forwarding the request to Frappe;
- adds `__scope` to same-origin `Location` response headers; and
- separately handles root-level static and Socket.IO paths.

This query parameter is a playground workaround, not a Frappe concept. It keeps
multiple in-browser instances isolated, but it must be propagated around URLs
that Frappe treats as origin-rooted.

Upstream relevance:

- Support a documented `SCRIPT_NAME` or application base-path contract across
  request routing, redirects, generated URLs, Desk boot, API calls, assets,
  files, and realtime.
- Provide one URL builder for internal root-relative paths instead of embedding
  leading-slash paths across Python and JavaScript.
- Add integration coverage for mounting Frappe below a reverse-proxy prefix.

This would be useful beyond the playground for proxied installations, embedded
applications, preview environments, and multiple isolated Frappe instances on
one origin.

### Some Frappe client modules reference package files below `node_modules`

The checked Frappe source contains runtime paths such as:

- `/assets/frappe/node_modules/ace-builds/...`
- `/assets/frappe/node_modules/html5-qrcode/...`
- `/assets/frappe/node_modules/qz-tray/...`
- `assets/frappe/node_modules/frappe-gantt/...`

The playground scans exported assets for these references, copies the referenced
files, and remaps them to `runtime_modules` for deployment.

Potential packaging improvement:

- Emit a complete manifest of files that may be loaded dynamically at runtime.
- Prefer a configurable public asset path over package-manager directory names in
  browser-facing URLs.

## Local Workarounds Requiring More Investigation

### Setup Wizard state repair

The playground directly repairs:

- `Installed Application.is_setup_complete`
- `System Settings.setup_complete`
- the `desktop:home_page` default

Frappe 16.20.0 already performs synchronous setup when
`trigger_site_setup_in_background` is false. Its setup code marks installed
applications complete, sets the home page to `workspace`, and updates System
Settings.

The local SQL repair therefore proves a state or persistence mismatch in this
Pyodide lifecycle, but it does **not** yet prove a Frappe core defect. Before
raising an upstream report, reproduce the failure without the repair and record:

1. the setup API response,
2. database values immediately after the request,
3. database values after WAL checkpoint and reload, and
4. whether Frappe's response iterator and after-response callbacks completed.

### Whoosh warnings on newer Python versions

Frappe imports Whoosh directly for full-text and website search. The playground
globally suppresses `SyntaxWarning` and `DeprecationWarning`, with a comment
attributing the warning to Whoosh on newer Python versions.

The dependency and suppression are confirmed. The exact warning, affected file,
and supported Python-version range have not been captured in this repository, so
the report should not claim a Frappe compatibility bug until the warning is
reproduced and recorded.

## Follow-up Checks

Before converting these notes into upstream reports or removing local mocks:

1. Import `frappe` with `psutil` unavailable and capture the exact failure.
2. Import `frappe.app` on SQLite with MySQLdb and RQ unavailable.
3. Import `frappe.utils.telemetry` with telemetry disabled and PostHog absent.
4. Remove each unverified module mock independently and run the browser suite.
5. Make auto-mocked integrations raise when called to expose hidden feature use.
6. Replace the fake `frappe` fallback with a clear missing-runtime exception.
7. Complete Setup Wizard without SQL repair and compare state before and after
   persistence.
8. Boot Desk without the Socket.IO mock and record the client behavior.
9. Mount Frappe below `/frappe-test/` using WSGI `SCRIPT_NAME` or proxy headers
   and inventory every redirect, asset, API, file, and Socket.IO URL that escapes
   to the origin root.

These checks separate Frappe portability findings from local defensive code and
produce small reproductions suitable for upstream discussion.
