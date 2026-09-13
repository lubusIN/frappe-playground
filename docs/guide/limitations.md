# Limits and browser support

Frappe Playground is a compatibility runtime for experiments, not a full replacement for Bench.

## Supported environment

- A current browser with WebAssembly, ES module workers, Service Workers, IndexedDB, Cache Storage, and `MessageChannel`.
- HTTPS in production, or `localhost` during development.
- A cross-origin-isolated document (`COOP: same-origin` and `COEP: require-corp`).
- Enough device memory and storage for Pyodide, Frappe assets, a SQLite database, and optional apps.

The project documents Chrome/Edge 80+, Safari/iOS 15+, and Firefox 114+ as minimum versions. Treat these as feature floors, not a promise that every Frappe workflow works on every device.

## Deliberate differences from Bench

| Bench capability | Playground behavior |
| --- | --- |
| MariaDB/Postgres | SQLite inside Pyodide |
| Redis cache | In-process `fakeredis` substitute |
| RQ workers/scheduler | Disabled; an import-compatible queue substitute covers selected flows |
| Socket.IO realtime | Minimal Engine.IO/namespace handshake; no realtime backend |
| Native Python extensions | Must have a Pyodide wheel, pure-Python fallback, or explicit compatibility shim |
| Server filesystem | In-memory Pyodide FS with selected site data checkpointed to IndexedDB |
| Backups and remote sync | Not provided |
| Arbitrary app install | Build-time curated catalog only |

## Security model

The generated site config enables developer mode, disables CSRF checks, disables telemetry, pauses the scheduler, and disables async work. Demo credentials are prefilled. Run the playground only as disposable client-side software; do not infer production-hardening properties from browser origin isolation.

## External network behavior

Execution is local after dependencies are loaded, but the current build is not a fully offline bundle:

- Pyodide is loaded from the exact configured base URL `https://cdn.jsdelivr.net/pyodide/v314.0.0/full/` and cached by the Service Worker. Treat `packages/server/src/boot.js` as the source of truth for this tag.
- Core and catalog-app Python dependencies may be downloaded by `micropip` at browser boot or install time.
- The playground fetches its prepared Frappe runtime, database, assets, and app archives from the deployment origin.
- Optional app behavior may call its own third-party APIs.
- Automated onboarding optionally queries `get.geojs.io` to infer a country.

Existing browser caches can make later boots work with less network access, but offline cold boot is not a supported guarantee. A self-hosted or air-gapped variant must change `PYODIDE_BASE_URL`, package resolution, and the published artifacts—not only mirror `dist/`.

For detailed Frappe compatibility findings and mock inventory, see the repository’s [`Technical_Notes.md`](https://github.com/lubusIN/frappe-playground/blob/main/Technical_Notes.md).
