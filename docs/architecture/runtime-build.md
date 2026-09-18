# Runtime build pipeline

The browser runtime is prepared in Docker because it starts from a real Frappe installation and cannot be assembled by the browser alone.

## Builder toolchain

`runtime/build/Dockerfile` currently uses:

- `python:3.14-slim` as the image;
- Node.js 24 from NodeSource;
- globally installed Yarn;
- `frappe-bench`; and
- the Frappe tag passed as `FRAPPE_VERSION`, defaulting to the value synchronized with `runtime/frappe-version.json`.

The image installs build tools and MariaDB development headers for the build environment even though the browser site itself runs SQLite.

## Core runtime archive

The builder shallow-clones the pinned Frappe tag, removes repository metadata, tests, documentation, caches, Markdown, nested `node_modules`, and selected package metadata, then copies the Python package into a flat archive root.

It predownloads selected wheels and deliberately builds pure-Python variants for packages that otherwise select native or source-only distributions. Wheel contents are unpacked into the archive and `.dist-info` directories are removed. The final image command adds PyPika and writes `frappe_runtime.tar.gz`.

## Base Frappe translations

The Bench asset build compiles Frappe's `.po` sources into `.mo` catalogs under `assets/locale/<language>/LC_MESSAGES/frappe.mo`. Packaging validates a compiled catalog for every source language before omitting sources. The runtime manifest records catalog sizes and hashes. The Python archive excludes `frappe/locale/*.po` and `*.pot`; those files are translation authoring inputs, not runtime catalogs.

Before starting Frappe, the worker mounts read-only lazy files at the matching `sites/assets/locale` paths. Frappe's own language resolution and parent-language fallback choose which files to read. Emscripten loads those bytes synchronously inside the Python worker on first access; the page's main thread remains separate. The service worker caches full catalog responses, including when a lazy file first probes with HEAD. English does not require a catalog. Only base Frappe is mounted this way; optional app translation loading is outside this change.

## Seed site

A temporary Bench is initialized with the same Frappe tag. The build creates `playground.local` using SQLite and Administrator password `admin`, enables `ignore_csrf`, and disables email-link login. The resulting database is exported as `site1.db`; browser boot writes it under the virtual site name `site1` and resets Setup Wizard completion markers for a fresh instance.

## Frontend assets

The builder exports the Bench `sites/assets` tree while excluding source-oriented `node_modules`, Sass, and Less directories. It scans generated CSS, HTML, JavaScript, JSON, SVG, and text for runtime references below `/assets/frappe/node_modules/`, copies only referenced files/directories, and relocates them to `/assets/frappe/runtime_modules/` for deployment. Missing discovered references fail the exporter.

ACE editor lazy directories are copied as units because filenames are selected dynamically at runtime and cannot all be discovered by static scanning.

## Public files in the Python archive

Base Frappe's browser fonts (`public/css/fonts`), images, and sounds are published separately under `/assets/frappe`. `package-core-runtime.py` checks every omitted file against that exported copy byte for byte before creating the Python archive; a missing or different copy fails the build.

Keep the remaining public files in the Python package. Frappe reads JavaScript through hooks (including Website Settings), scans icon directories during boot, and can read styles, SCSS, and templates server-side. A browser asset URL does not make a file available to Python's filesystem. This pruning is limited to base Frappe; optional app packages are unchanged.

## Catalog apps

For every authored catalog entry, the build:

1. initializes a repository and shallow-fetches the exact 40-character commit;
2. installs it editable into the temporary Bench environment;
3. runs `yarn install --frozen-lockfile` when the app has `package.json`;
4. adds it to `sites/apps.txt` and runs `bench build --app`;
5. creates a deterministic ZIP of the Python package; and
6. records its byte length and SHA-256 in the generated catalog.

The ZIP uses sorted paths, a fixed 2020 timestamp, fixed file mode, and maximum deflate compression. It excludes `.git`, `__pycache__`, `node_modules`, `.pyc`, top-level catalog exclusions, and files whose names begin with `test_`.

## Output and manifest

Docker writes intermediate files to `artifacts/runtime/`. `scripts/build.sh` expands `assets.tar.gz`, removes that temporary archive, and generates `manifest.json` for the core archive, seed DB, asset manifest, generated app catalog, and app ZIPs.

The shell assembly later copies these into `dist/`. `artifacts/` and `dist/` are generated, ignored directories; never use them as authored inputs.

## Download and cache behavior

Keep browser assets separate from the Python runtime archive. The service worker fetches individual scripts, styles, images, and translations when requested and caches successful responses in CacheStorage. Publishing assets does not download them at startup; unused app assets, languages, and source maps do not need to be included in the initial transfer. Optional app Python archives are downloaded when installing that app.

The extracted Python environment is persisted in IDBFS and versioned by the runtime archive SHA-256 in `storage/manifest.json`. Changing the archive forces re-extraction. The asset cache identity combines the asset manifest, app catalog, and runtime manifest, so a new build invalidates previously cached assets.

Runtime publication fails if generated files exceed the hosting size or count limits. Further reduction of the core Python archive is a separate optimization from on-demand browser asset delivery.
