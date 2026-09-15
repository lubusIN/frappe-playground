# Server worker internals

Each active playground owns a dedicated module Web Worker. It contains one Pyodide interpreter, one in-memory Bench-shaped filesystem, one WSGI bridge, one scoped state store, and one serial request queue.

## Module state

The worker reads `scope` and `fresh` from its own entry URL. Important module-level state includes:

- `pyodide`, created once per worker;
- `bootPromise`, shared by every channel initialization;
- the generated app catalog;
- `BrowserStateStore` for the scope; and
- `requestExecutor`, a FIFO shared by requests, app changes, and their saves.

If boot rejects, `bootPromise` is cleared so a later channel initialization can retry inside the same worker. Normal shell error handling generally reloads or disposes the worker.

## Boot composition

`bootPython()` composes modules instead of embedding their implementations:

1. `boot.js` loads Pyodide and browser-installed packages;
2. `filesystem.js` restores/extracts the shared environment;
3. `persistence.js` restores or seeds scoped site state;
4. `app-installer.js` verifies and prepares previously installed catalog apps;
5. static site config, current-site, asset manifest, and app list are written; and
6. `request-handler.js` configures mocks, SQL polyfills, and the WSGI Python source.

The installed app list is reported in `runtime:ready` both to the Service Worker channel and the shell’s worker listener.

## Channel attachment

Every `channel:init` can attach a new Service Worker port to the already booted interpreter. This is the recovery mechanism: losing the router port does not require reloading Python or Frappe.

`SerialRequestExecutor.attach()` closes the previous receiving port and installs a listener on the replacement, retaining the existing queue. Each backend request contains a one-shot response port. Requests join an in-memory FIFO; only one handler call runs at a time, and the next item is scheduled with a zero-delay timer so control returns to the worker event loop.

## WSGI bridge memory discipline

The bridge converts request/header maps to Python proxies, places the request in Pyodide globals, and calls the top-level Python `handle_request`. The response is converted back with `Object.fromEntries`; both request and response PyProxy values are destroyed in `finally` to avoid retaining WebAssembly/Python heap objects across requests.

Python consumes the complete WSGI iterable before returning bytes. Exceptions become text/plain 500 responses containing the worker error/trace, while JavaScript bridge errors are encoded by the executor’s error path.

## Persistence policy

After WSGI returns, `shouldPersistRequest` snapshots all methods except `GET`, `HEAD`, and `OPTIONS`. Those normally read-only methods still snapshot if Frappe returns `Set-Cookie`. Persistence runs before the response message is posted, so a successful mutating response implies that the save completed. Storage errors produce a failed response.

The snapshot first checkpoints SQLite’s WAL, then saves database bytes, cookie JSON, selected site files, installed app IDs, and metadata. This policy relies on applications respecting HTTP method semantics.

## App mutation transaction boundary

Install/uninstall messages enter the same executor as HTTP requests. Each operation includes its checkpoint and save, preventing schema changes, application requests, and snapshots from overlapping. A failed operation rejects its caller without poisoning the queue.

Before mutation, the worker checkpoints and copies database bytes plus the installed-app list. Success checkpoints and saves the combined state. Failure restores those two items, removes sidecars, rewrites `apps.txt`, and returns an operation error. Downloaded/unpacked Python files and newly installed Python dependencies are outside this rollback boundary.

## Failure reporting

Boot stages emit structured progress to the shell. A boot error is logged and wrapped as `runtime:error`. App errors are request-correlated results and do not crash the runtime. Backend exceptions become HTTP 500 responses so the browser request completes instead of leaving its response port unresolved.
