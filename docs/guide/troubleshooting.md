# Troubleshooting

Start with the loading screen and browser developer tools. Boot progress separates Service Worker, Python, runtime extraction, database, and Frappe failures.

## “Service workers are unavailable”

The browser does not expose `navigator.serviceWorker`. Use HTTPS or `localhost`, leave private/restricted browsing if it disables persistent browser APIs, and confirm Service Workers are enabled by browser policy.

## Registration or update timed out

Registration is bounded at 15 seconds and legacy-worker activation at 30 seconds. Reload once, then inspect the Application panel for an old `/sw.js` registration. Closing other tabs for the same origin can allow a waiting worker to activate.

The shell intentionally reloads when an already-running page receives a replacement Service Worker. This is how it avoids mixing runtime releases.

## The runtime connection is unavailable

The Service Worker lost its in-memory instance registry, commonly after the browser restarted it. It broadcasts a recovery request and waits up to five seconds for a visible shell to transfer a new channel. Navigations that cannot recover are redirected to the shell with the intended route in `?path=`; non-navigation requests return `503` with `Retry-After: 1`.

Bring the shell tab to the foreground and retry. The client re-establishes its channel on visibility changes.

## An instance does not finish booting

The Service Worker waits up to 90 seconds for a selected worker channel to report ready for each backend request, although the overall UI and end-to-end tests allow a longer cold boot. Check the console and network panel for:

- the configured jsDelivr Pyodide loader;
- Python package downloads initiated by `micropip`;
- `/assets/assets.json` and `/apps/catalog.json`;
- `/storage/frappe_runtime.tar.gz` and `/storage/site1.db`; and
- JavaScript, WebAssembly, CORS, MIME-type, or cross-origin-embedder errors.

A failure during creation of a fresh instance removes that instance’s local database and catalog entry to avoid retaining a partially initialized site. A failure restoring an older site leaves it available for retry.

## `crossOriginIsolated` is false

Evaluate `window.crossOriginIsolated` on the top-level playground page. If false, inspect the document response for:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Then inspect cross-origin dependencies for suitable CORS/CORP behavior. Redirects, preview proxies, authentication layers, and custom error pages must preserve the required policy.

## An app install fails

Keep the tab open for the entire operation; the shell timeout is ten minutes. Confirm the app is present in the generated `/apps/catalog.json`, its archive size/hash matches, Web Crypto is available, and all declared Python dependencies can install in Pyodide. A catalog app can still fail later because its schema or hooks require unsupported Frappe services or MariaDB behavior.

Rebuilding only the shell cannot refresh a changed app recipe. Run `npm run build:runtime`, then the complete build.

## Reset or delete says the database is blocked

Another tab or worker has the instance’s IndexedDB database open. Close pages using that instance and retry. Resetting removes the site snapshot but not shared Cache Storage or the extracted Python environment.

## The wrong site opens from a URL

`name` selects the first existing instance with an exact matching display name. Names are not guaranteed unique; instance IDs are. Rename duplicates or delete the unwanted local instance. Remember that instance state is origin-specific, including the port used in local development.

## A nested shell appears inside Frappe

The client listens for a `frappe-playground-nested-shell` message and bounces the iframe back to a scoped route with a temporary cache-busting query parameter. If it repeats, capture the originating navigation and add it to the scoped-navigation tests; it usually indicates a Frappe link escaped the scope rewrite.

## Clear everything locally

Use the browser’s site-data controls for the exact playground origin. This removes instance catalogs, scoped databases, the shared extracted environment, and Cache Storage. It is irreversible unless you separately captured the data; there is currently no built-in backup/import mechanism.
