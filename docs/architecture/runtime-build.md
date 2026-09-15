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

## Seed site

A temporary Bench is initialized with the same Frappe tag. The build creates `playground.local` using SQLite and Administrator password `admin`, enables `ignore_csrf`, and disables email-link login. The resulting database is exported as `site1.db`; browser boot writes it under the virtual site name `site1` and resets Setup Wizard completion markers for a fresh instance.

## Frontend assets

The builder exports the Bench `sites/assets` tree while excluding source-oriented `node_modules`, Sass, and Less directories. It scans generated CSS, HTML, JavaScript, JSON, SVG, and text for runtime references below `/assets/frappe/node_modules/`, copies only referenced files/directories, and relocates them to `/assets/frappe/runtime_modules/` for deployment. Missing discovered references fail the exporter.

ACE editor lazy directories are copied as units because filenames are selected dynamically at runtime and cannot all be discovered by static scanning.

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

## Cache invalidation nuance

The browser’s extracted environment version is derived from the text of `assets/assets.json`, while the worker entry build ID includes broader source and manifest inputs. A runtime change that does not alter the asset manifest still changes worker URLs, but may not force the IDBFS archive to re-extract. When changing archive contents independently of assets, test a browser with existing site data and clear site data if diagnosing an unexpectedly reused environment.
