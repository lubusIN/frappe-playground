# Compatibility and upstream notes

::: warning Version-specific evidence
These observations describe the repository's pinned Frappe runtime and its tested browser flows. They are engineering evidence for maintaining the playground and preparing focused upstream reports—not guarantees about every Frappe release or deployment.
:::

## What this page is for

This document records Frappe-specific observations that may be useful for
upstream improvements. They come from running Frappe Framework inside Pyodide
with SQLite, without external Redis, RQ workers, or Socket.IO.

This is a maintenance record, not a collection of ready-to-file issues. Before
reporting anything upstream, reduce it to one independently reproducible
behavior against a supported Frappe environment.

Browser platform requirements such as Service Worker routing, IndexedDB storage,
cross-origin isolation headers, and per-tab URL scoping are intentionally excluded
unless they expose a concrete Frappe integration constraint.

## Reference scope

- The generated runtime currently contains **Frappe 16.30.0**.
- `runtime/build/Dockerfile` builds from a pinned tag (`v16.30.0`) via a build argument,
  declared once in `runtime/frappe-version.json`. These notes therefore describe the
  checked runtime artifact, not every version of Frappe 16.
- `tests/contract/runtime-version.test.mjs` fails if this document, `scripts/build.sh`,
  the Dockerfile default, and `runtime/frappe-version.json` ever disagree. Update the
  version file and this line together.
- Local behavior is covered by the repository's Playwright flows, including
  boot, login, Setup Wizard, Desk, file upload, and scoped reloads.

## How to read the evidence

The sections use three evidence levels:

| Level | Meaning |
| --- | --- |
| **Confirmed runtime requirement** | Removing the substitute breaks an exercised boot or request path. |
| **Feature-path guard** | Imports remain available, but the underlying integration is not implemented. |
| **Removal candidate** | No current source reference or tested failure demonstrates that the mock is needed. |

A local workaround can establish a portability constraint without proving that
Frappe itself has a defect. The final section lists the checks still needed to
turn observations into reproducible upstream reports.

## Upstream candidates

These summaries are starting points. The implementation evidence and caveats
appear in the later sections.

### Issue 1: Eager MariaDB backend imports during SQLite runtime execution

**Problem:** Even when `db_type` is configured as `"sqlite"`, `frappe.app` and related database initialization modules eagerly perform top-level imports of `frappe.database.mariadb` dependencies, which ultimately require the native compiled `mysqlclient` C extension.

**Impact:** Prevents Frappe from booting in environments where only SQLite is supported or where `mysqlclient` cannot be compiled (e.g., pure WebAssembly/Pyodide environments).

**Possible improvement:** Resolve database backends lazily according to the active `db_type`, for example with `importlib.import_module`.

### Issue 2: Top-level `rq` imports in `background_jobs` bypass disabled async configuration

**Problem:** In `frappe/utils/background_jobs.py`, classes like `Queue`, `Worker`, and `Job` from the `rq` package are imported at the module level. Setting `is_async=False` only changes runtime routing, not import-time requirements.

**Impact:** Codebases attempting to run Frappe in a single-threaded synchronous environment without Redis Queue dependencies crash at module-load time.

**Possible improvement:** Move RQ references into the operations that dispatch asynchronous work, or place them behind an adapter.

### Issue 3: Cache and session initialization require Redis

**Problem:** Core state mechanisms (`frappe.cache()`, session tracking, and global locks) assume a live, network-reachable Redis broker during basic system startup, even if background processing and webhooks are disabled.

**Impact:** Prevents minimal, isolated system boot or serverless execution contexts that require in-memory or alternative fallback state engines.

**Possible improvement:** Provide an explicitly configured in-memory cache implementation for standalone environments.

### Candidate 4: Recheck telemetry provider imports

**Historical observation:** Earlier runtime work found the telemetry facade importing `posthog` before checking whether telemetry was enabled.

**Current status:** The pinned Frappe 16.30.0 runtime has changed its telemetry implementation, and the mock-removal audit now treats `posthog` as a removal candidate. Do not report the historical behavior upstream without reproducing it against the current source.

**Possible improvement if reproduced:** Load the configured telemetry provider only after telemetry is enabled.

### Issue 5: Native packages (`orjson` and `psutil`) have no portable fallback

**Problem:** Deep integration of `orjson` (for high-performance serialization) and `psutil` (for system metrics) occurs without standard library fallbacks (`json`) or mocking frameworks for environments missing process tree APIs.

**Impact:** Immediate runtime crashes on platforms without native compilation toolchains or operating system hooks (like browser sandboxes).

**Possible improvement:** Route serialization and process inspection through Frappe-owned adapters that can provide documented portable fallbacks.

### Issue 6: Desk initializes realtime without a disable flag

**Problem:** The Desk application client (`desk.js` and boot pipelines) initializes the Socket.IO runtime instance by default. There is currently no option to gracefully bypass this connection pool.

**Impact:** In setups without a node real-time proxy, the browser console experiences continuous, non-breaking but disruptive connection polling/retry failures.

**Possible improvement:** Support a boot flag that cleanly skips Socket.IO initialization when realtime is intentionally unavailable.

### Issue 7: Absolute, origin-root assumptions prevent subdirectory deployment

**Problem:** Internal routing engines, asset resolution strings (`/assets/...`), internal API endpoints, and Socket.IO handshakes are hardcoded to rely on root-relative URL paths.

**Impact:** Frappe applications fail to resolve assets and break functionality when reverse-proxied or mounted below a URL prefix path (e.g., `example.com/myapp/`).

**Possible improvement:** Establish one base-path contract for generated URLs, assets, API calls, redirects, files, and realtime requests.

### Issue 8: Runtime-loaded client modules bypass the central asset manifest

**Problem:** While `bench build` produces a standard asset manifest mapping version fingerprints, specific legacy modules and dynamic script split paths pull dependencies natively from paths under `/assets/frappe/node_modules/...`.

**Impact:** Breaks progressive build pipelines, immutable static hosting deployments, and compilation configurations where every single client-side asset footprint must be explicitly declared ahead of time.

**Possible improvement:** Include every runtime-loaded browser dependency in a generated, versioned asset manifest.

## Compatibility implementation inventory

`runtime/python/frappe_mocks.py` modifies Python imports before loading Frappe.
The mocks do not all mean the same thing:

- some provide working local substitutes for services Frappe actively uses;
- some only satisfy import-time symbols;
- some disable optional integrations by returning inert objects; and
- some have no demonstrated use in the checked runtime.

The presence of a mock is not, by itself, evidence of an upstream defect.

### Confirmed runtime requirements

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

### Feature-path guards

The auto-mocker also intercepts:

- `google` and `googleapiclient`
- `ldap3`
- `sentry_sdk`

Google and LDAP imports exist in their corresponding Frappe integration modules,
but those modules are not required for ordinary boot. Their mocks allow an
integration module to import if a hook, DocType, or route reaches it. The actual
integration cannot work because calls are absorbed.

`sentry-sdk` is already installed by `runtime/config/packages.js`, but the auto-mocker
shadows it. Frappe's web setup imports Sentry only when related environment
variables are configured; error-reporting helpers can also import it on demand.
The reason for overriding the installed package has not been demonstrated.

These mocks are disabled-feature guards, not confirmed boot-path requirements.

Upstream relevance:

- Optional integration modules should remain lazy and provide a clear
  "dependency not installed" error when invoked.
- Returning inert objects is useful for experimentation but can hide accidental
  feature execution.

### Removal candidates

The checked Frappe source does not establish a SQLite boot-path requirement for:

- `psycopg2` and its submodules, which belong to the Postgres backend;
- `pwd` and `grp`, for which no imports were found in the bundled Frappe source;
- `posthog`, which the current removal audit identifies as obsolete after the
  Frappe 16 telemetry changes;
- `twilio`;
- `boto3` and `botocore`;
- `dropbox`;
- `braintree`;
- `stripe`; or
- `plaid`.

The vendor names above have no demonstrated requirement in the checked boot and
request flows. They may be historical defensive mocks or intended for optional
application code outside the current runtime.

These entries should be tested for removal locally. They should not be cited as
Frappe dependencies without a failing import or executable reproduction.

### Risks and maintenance policy

`AbsorbingMock` returns another inert object for nearly every operation. This
keeps imports moving, but it can convert unsupported behavior into an apparent
success. The generic import finder also mocks every submodule below each listed
prefix, which makes accidental feature use difficult to detect.

The loader already fails explicitly when the real `frappe` package is absent.
Keep that failure strict: a missing or incomplete runtime archive must never be
hidden behind a fabricated Frappe module.

Local cleanup should prefer:

1. explicit, minimal mocks for imports proven necessary;
2. exceptions when a disabled integration is actually invoked;
3. removal tests for unreferenced mocks; and
4. a hard failure when the real `frappe` package is unavailable.

## Detailed integration constraints

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

The playground therefore uses structural paths of its own:

```text
/scope:<id>/desk
/scope:<id>/api/method/...
```

The Service Worker then:

- reads scope from the URL prefix or its browser-client mapping;
- removes `/scope:<id>` before forwarding the request to Frappe;
- adds the scope prefix to same-origin `Location` response headers; and
- separately handles root-level static and Socket.IO paths.

The older `?__scope=<id>` form is still accepted as a compatibility input, but
new navigation uses the path prefix. This scope is a playground workaround, not
a Frappe concept, and must be propagated around URLs that Frappe treats as
origin-rooted.

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

## Workarounds that need more investigation

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

Frappe imports Whoosh directly for full-text and website search. Since Whoosh
is unmaintained and relies on deprecated Python features, it triggers loud
`SyntaxWarning` and `DeprecationWarning` messages on newer Python versions
(like Python 3.12+).

To keep the console clean without masking real syntax errors in Frappe or custom
code, the playground explicitly filters and suppresses these warnings only for
the `whoosh.*` module in `boot.js`.

### Integration mock strictness

The auto-mocked integration tree—for example `googleapiclient`, `stripe`, and
`boto3`—allows imports but reports actual use. Calling a mock shows a toast,
prints a warning, or raises `DisabledIntegrationError`, depending on the mode.

`PLAYGROUND_INTEGRATION_MOCK_MODE` controls the behavior:

| Value | Behavior |
| --- | --- |
| `toast` | Default. Print a warning and try to show a Frappe alert. |
| `warn` | Print a warning and absorb the call. |
| `strict` | Record the call and raise `DisabledIntegrationError`. |

The mode is read when `frappe_mocks.py` is evaluated. Tests or derived clients
that need another mode must set it in the Pyodide environment before evaluating
that source; the stock UI does not expose a runtime setting for it.

```javascript
pyodide.runPython(`
  import os
  os.environ["PLAYGROUND_INTEGRATION_MOCK_MODE"] = "strict"
`)
```

## Follow-up checklist

Before converting these notes into upstream reports or removing local mocks:

1. Import `frappe` with `psutil` unavailable and capture the exact failure.
2. Import `frappe.app` on SQLite with MySQLdb and RQ unavailable.
3. Import `frappe.utils.telemetry` with telemetry disabled and PostHog absent.
4. Run the automated mock removal tester (`npm run test:mock-removal`) to verify which module mocks can be safely deleted without breaking the browser suite.
5. Complete Setup Wizard without SQL repair and compare state before and after
   persistence.
6. Boot Desk without the Socket.IO mock and record the client behavior.
7. Mount Frappe below `/frappe-test/` using WSGI `SCRIPT_NAME` or proxy headers
   and inventory every redirect, asset, API, file, and Socket.IO URL that escapes
   to the origin root.

These checks separate Frappe portability findings from local defensive code and
produce small reproductions suitable for upstream discussion.
