# Optional apps

The app manager installs only applications prepared in the build-time catalog. It cannot install an arbitrary Git repository at runtime.

## Current catalog

The authored catalog currently contains ERPNext 16.30.0, Frappe CRM 1.81.1, Frappe Wiki 3.0.0-rc.4, and Frappe Vault 1.1.0. Every entry is marked experimental and pinned to a specific Git commit; `runtime/apps/catalog.json` is the source of truth.

![The optional-app manager listing installable catalog apps](/images/app-manager.png)

*Open **Apps** from the dock and select **Install** beside a catalog entry. The operation applies only to the active playground.*

## Installation lifecycle

1. The shell loads `/apps/catalog.json` and validates its generated metadata.
2. An install request crosses the versioned worker protocol and receives a generated request ID. The shell allows up to ten minutes for its result.
3. The server worker installs declared Python dependencies with `micropip` using `keep_going` where applicable.
4. It downloads the prepared archive, verifies both its byte length and SHA-256 digest, then unpacks it into the Pyodide filesystem.
5. Frappe’s install lifecycle updates the current site.
6. The database and installed-app list are persisted together. The shell reloads so hooks, DocTypes, and assets initialize with the new app present.

An uninstall calls Frappe’s `remove_app(..., yes=True, no_backup=True)`, then persists the new app list. Mutations are serialized. If a mutation fails, the worker restores its in-memory database backup and previous installed-app list. It does not roll back packages or archive files already added to the shared virtual environment; the authoritative installed-app list controls which apps are prepared on the next boot.

The shell reloads after an app-manager install or uninstall. Keep the tab open while the operation runs. App installs initiated by URL boot flags occur before the initial iframe navigation and do not add an extra reload at that point.

## Compatibility constraints

Apps must be deliberately adapted and built for this environment:

- Python dependencies need Pyodide-compatible or pure-Python wheels.
- Frontend assets must be built ahead of time and published under the declared asset prefix.
- Code that requires MariaDB semantics, Redis services, system processes, native extensions, background workers, or a real Socket.IO server may not work.
- External integrations may be unavailable or intentionally mocked.

Core and per-app `micropip` dependencies are resolved during browser boot/install, so a cold environment needs network access to their package indexes in addition to the statically hosted artifacts.

To add an app to a self-hosted build, follow [Customize the app catalog](/hosting/customize#add-an-app-to-the-catalog).
