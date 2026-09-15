# Persistence and isolation

The runtime separates shared immutable files from scoped mutable state.

## Shared data

Published Frappe, frontend, and optional-app assets are common to the origin. The Service Worker caches static/runtime responses and the configured jsDelivr Pyodide distribution in Cache Storage. Its cache name is derived from the contents of the Frappe asset manifest, generated app catalog, and runtime manifest; old `frappe-assets-*` caches are deleted when that identity changes. Documentation requests deliberately bypass this cache because docs can change without runtime artifacts changing.

The extracted Python virtual environment is cached separately using Pyodide’s `IDBFS` mounted at `/home/pyodide/frappe_env`. The runtime archive SHA-256 from `storage/manifest.json` is stored in `version.txt`. When the hash matches, extraction is skipped; when it changes, obsolete environment files are removed and the prepared runtime archive is unpacked and the mount is synchronized back to IndexedDB. This environment cache is shared by workers through its fixed IDBFS mount, while site databases remain scope-specific.

Each active instance still has its own dedicated Pyodide worker and in-memory filesystem.

## Scoped state

`BrowserStateStore` opens `frappe_playground_db_<scope>` at schema version 1 and creates one `files` object store. A save atomically updates these records:

| Record | Contents |
| --- | --- |
| `site1.db` | SQLite database bytes after WAL checkpoint |
| `cookie_jar.json` | Python bridge cookie jar |
| `site_files` | Byte snapshots from public and private site file roots |
| `installed_apps` | Catalog app IDs restored on the next boot |
| `manifest.json` | Save time and scope metadata |

The state preload starts when the worker’s store is constructed, overlapping early boot work. A non-fresh site restores that snapshot. Only an explicitly missing snapshot permits seeding. Read or restore failures stop boot without saving; the read connection closes on success or failure. If none exists, the worker copies the published seed database and resets its Setup Wizard markers.

## Database consistency

Before snapshotting, `checkpointDatabase()` executes `PRAGMA wal_checkpoint(TRUNCATE)` and verifies that it completed without a busy result. SQLite owns its sidecars; checkpointing never unlinks them. Failed checkpoints, IndexedDB writes, and transaction aborts propagate to the caller rather than reporting a successful save. Restored completed sites receive a narrow repair for a stale Setup Wizard home-page default.

App mutations create an in-memory database backup and installed-app-list backup. On failure, both are restored and SQLite sidecars are removed. This rollback covers the current worker process; it is not a general transactional backup system.

All backend requests and app mutations share one runtime queue, including their persistence work. Reconnecting a channel attaches it to the same executor, so recovery cannot introduce concurrent Python operations.

## File safety

Only files below the configured public/private roots are restored. Restore ignores unknown roots and paths containing `.` or `..` components. Runtime files, app source, and generated assets are reconstructed from immutable published artifacts rather than saved per instance.

## Lifecycle caveats

- Worker termination before a required post-request save can lose the most recent mutation.
- Successful `GET` requests without `Set-Cookie` are intentionally not snapshotted, even if application code incorrectly mutates state during a GET.
- IndexedDB quota and eviction policies are controlled by the browser.
- Site state is tied to the exact scheme, host, and port.
- There is no migration or export workflow for moving an instance between origins.
- Reset and delete target only the selected instance's IndexedDB database, which contains the database, cookies, files, and installed-app list. Browser asset caches and the shared extracted runtime environment are unaffected.
