<p align="center"><img width="250" src=".github/logo.svg"></p>

![Frappe Playground](.github/banner.jpg)

# Frappe Playground

Run the Frappe Framework entirely in the browser with Pyodide and WebAssembly. A Vue shell boots Frappe inside dedicated Web Workers and routes same-origin requests through a Service Worker into Python WSGI. Named playgrounds are isolated and persisted in browser storage, so multiple Frappe sites can be created, reopened, reset, and managed without a traditional Python server.

> [!CAUTION]
> Project is currently experimental and under active development.

## Overview

The playground has five main pieces:

1. **Vue shell (`packages/client/`)**: Renders boot progress, the dock, the instance manager, and the Frappe iframe. `packages/client/src/playground/` owns runtime lifecycle, the persistent instance catalog, Service Worker coordination, and scoped iframe navigation independently of Vue components. Vite emits shell assets into `dist/frontend/`.
2. **Service Worker (`packages/service-worker/`)**: Routes each scoped request to the correct server worker, associates browser clients with instances, caches runtime assets, preserves scoped redirects, and supports channel recovery across reloads. One Service Worker is shared by every instance on the origin.
3. **Pyodide server (`packages/server/`)**: Each playground starts a dedicated worker that composes the Pyodide loader, filesystem installer, scoped IndexedDB persistence, database lifecycle, Python bridge, and serial WSGI request executor. Browser-specific Python sources in `runtime/python/` are converted into a build-time JavaScript module.
4. **Shared protocol (`packages/protocol/`)**: Defines the versioned messages exchanged by the shell, Service Worker, and Pyodide server.
5. **Runtime build (`runtime/`, `scripts/build.sh`)**: Keeps Python helpers, runtime configuration, the optional-app catalog, the Dockerfile, and asset exporter together, and builds intermediate Frappe runtime artifacts into `artifacts/runtime/`. The application build assembles those artifacts and all authored browser sources into the clean `dist/` publish directory.

The app must be served from `localhost` or HTTPS with cross-origin isolation headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Access-Control-Allow-Origin: *
```

Vite sets these headers during local development and preview. Cloudflare Pages uses the authored `static/_headers` file copied into `dist/` during assembly.

## Features

- Run Frappe Desk and Python WSGI entirely in the browser.
- Create and name multiple isolated playground instances.
- Switch, rename, reset, and delete saved playgrounds from the dock.
- Browse, install, and uninstall curated optional apps in each playground.
- Persist each instance's SQLite database, cookies, and uploaded site files in IndexedDB.
- Preserve Frappe navigation and redirects behind scoped paths such as `/scope:<instance-id>/...`.
- Recover runtime channels and Service Worker state across normal and cache-bypassing reloads.
- Display structured progress while Pyodide, Frappe assets, and the site database initialize.

## Browser Support

Frappe Playground heavily relies on modern Web APIs, including WebAssembly and ES Module Workers, to boot the Python environment. It requires a modern browser to run:

- **Chrome / Edge:** Version 80 or newer (2020+)
- **Safari / iOS:** Version 15 or newer (2021+)
- **Firefox:** Version 114 or newer (2023+)

## Runtime flow

```text
Vue client
  -> creates a scoped server Web Worker
  -> transfers a MessageChannel to the Service Worker and server worker

Browser request
  -> Service Worker resolves the instance scope
  -> request envelope crosses the MessageChannel
  -> Pyodide server executes Frappe WSGI
  -> response envelope returns to the browser
```

The human-facing address bar displays ordinary Frappe routes while the iframe
uses scoped paths internally. Shared contracts in `packages/protocol/` are the
only supported coupling between the three browser contexts.

### Default Credentials

The login form is automatically prefilled for local experimentation:

```text
Username: Administrator
Password: admin
```

These presentation defaults live in `packages/client/src/playground/config.js`.
The credentials are intended only for browser-local playground data.

CSRF validation is bypassed only when the site config sets `ignore_csrf`, so a
derived deployment cannot inherit the bypass silently.

### Disabled integrations

Optional integrations (Google, LDAP, PostHog, Stripe, and similar) are mocked so
that Frappe can import them, because Frappe imports several of them before
checking whether they are configured. Importing always succeeds; *calling* one
raises `DisabledIntegrationError` by default, so a stub cannot silently stand in
for a working feature. Override with the `PLAYGROUND_INTEGRATION_MOCK_MODE`
environment variable, which accepts `strict` (default), `warn`, or `absorb`.

## Boot Flags (URL Configuration)

The Frappe Playground supports URL query parameters to automatically configure and boot the playground into a specific state.

Supported parameters:
| Parameter | Description |
| :--- | :--- |
| `apps` | Comma-separated list of app IDs to automatically install (e.g., `?apps=crm,wiki,frappe_vault`). |
| `login` | Set to `1`, `true`, or `auto` to automatically log in as the default Administrator. |
| `onboarding` | Set to `0` or `false` to auto-login, automatically complete the Frappe setup wizard with localized defaults, and land directly on the desk. |
| `path` | The URL path to land on after booting (e.g., `?path=/app/todo`). Defaults to `/desk` if auto-logged in, or `/` otherwise. |
| `name` | The name of the playground instance to load or create. |

**Example:**
`http://localhost:5173/?name=Demo&apps=crm&onboarding=0`
*Creates a new playground named "Demo", installs the CRM app, auto-logs in as Administrator, completely skips the setup wizard, and drops the user straight into Frappe Desk.*

## Getting Started

Install dependencies:

```bash
npm install
```

Build the browser runtime artifacts with Docker:

```bash
npm run build:runtime
```

Start the local Vite dev server:

```bash
npm run dev
```

Open `http://localhost:5173/`.

The runtime build is required when `artifacts/runtime/` is missing or when the
Frappe runtime inputs change. Subsequent client-only development can reuse the
existing artifacts.

### ERPNext

ERPNext is **pre-baked into the runtime image**, not installed through the
optional-app catalog:

```bash
npm run build:runtime:erpnext
```

The catalog installer suits small apps like CRM and Wiki. ERPNext ships 638
DocTypes, and running `install-app` inside single-threaded Pyodide would mean
thousands of sequential SQLite inserts in the browser, so the install cost is
moved into the Docker build and the browser only unpacks the result.

Two compatibility layers make this work, both under `runtime/python/`:

- `sqlite_compat.py` — ERPNext targets MariaDB, and
  [SQLite support is still an open request upstream](https://github.com/frappe/erpnext/issues/56443).
  Frappe's SQLite driver already rewrites backticks, `locate()` and table names,
  but not MariaDB's date functions. This adds `DATE_ADD`/`DATE_SUB`/`DATE_FORMAT`/
  `DATEDIFF`/`TIMESTAMPDIFF`/`IF()`/`ON DUPLICATE KEY`, reproducing MySQL's
  DATE-vs-DATETIME return type rather than approximating it.
- `rapidfuzz_compat.py` — rapidfuzz is ERPNext's only non-pure-Python dependency
  and ships compiled wheels only. It is used in exactly one file (bank
  transaction party matching), so a pure-Python substitute stands in. Scores are
  computed, not stubbed, but they are not bit-identical to the C++ implementation.

The build reports every artifact against the Cloudflare Pages 25MB per-file cap.
An ERPNext runtime archive may exceed it, which would require splitting the
archive across files and reassembling it in `packages/server/src/filesystem.js`.

Optional app sources are declared in `runtime/apps/catalog.json`. Validate the
catalog without running Docker using `npm run validate:apps`. The runtime build
fetches immutable commits, builds their frontend assets, and emits deterministic
install archives under `artifacts/runtime/apps/`. The server runtime can verify
and install those archives into a selected playground through its versioned
worker protocol. The dock app manager exposes that catalog and reloads the
playground after app changes so Frappe starts with the correct hooks and
DocTypes. Build verification fingerprints the authored catalog and rejects
stale generated app archives in CI.

For a production-style local preview, build the Vue shell and start Vite preview:

```bash
npm run build
npm start
```

Open `http://localhost:8000/`.

To run the complete deploy preparation flow in one command:

```bash
npm run predeploy
```

This rebuilds the runtime artifacts, builds the frontend shell into a clean `dist/`, assembles the authored runtime files, and checks published asset limits.

## Directory Structure

```text
frappe-playground/
|-- packages/
|   |-- client/             # Vue shell, instance catalog, and orchestration
|   |-- protocol/           # Versioned cross-context contracts and scoped URLs
|   |-- service-worker/     # Origin routing, instance registry, cache, and proxy
|   `-- server/             # Pyodide boot, persistence, filesystem, and WSGI bridge
|-- runtime/
|   |-- python/             # Authored Python bridge helpers and mocks
|   |-- config/             # Python package and site configuration
|   |-- apps/               # Authored optional-app catalog
|   `-- build/              # Dockerfile and runtime asset exporter
|-- static/                 # Authored static hosting files only
|-- artifacts/
|   |-- generated/          # Generated JavaScript sources used by browser workers
|   `-- runtime/            # Generated runtime, app archives, assets, and manifest
|-- dist/                   # Generated deployable application
|-- scripts/
|   |-- build.sh            # Docker runtime build
|   |-- check-limits.sh     # Asset size limit verification
|   |-- deploy.sh           # Cloudflare Pages deployment
|   |-- prepare.sh          # Assembles runtime and authored files into dist/
|   `-- prepare-deploy.sh   # Full deploy preparation flow
|-- tests/
|   |-- contract/           # Fast module, protocol, and MessageChannel tests
|   `-- e2e/                # Playwright boot, persistence, and UI flows
|-- vite.config.mjs
`-- playwright.config.js
```

`artifacts/` and `dist/` are generated and intentionally ignored by Git. Authored source files never live in either directory.

Application code may import shared contracts from `packages/`, but applications must not import implementation modules from sibling applications. Build scripts are responsible for mapping authored application entry points to their stable public URLs in `dist/`.

Each package contains a README with its responsibilities, boundaries, important
entry points, and focused verification commands.

## Browser storage and isolation

The client stores the instance catalog and active instance ID in `localStorage`.
Each server worker stores persistent site state in a scoped IndexedDB database:

```text
frappe_playground_db_<instance-id>
```

Reset and delete operations target only that database. The Pyodide environment
and immutable Frappe runtime assets are shared browser caches, while SQLite,
cookies, and uploaded public/private files remain isolated per playground.

Clearing browser site data removes saved playgrounds. This project does not yet
provide remote synchronization or server-side backups.

## Testing

The Playwright suite starts and owns an isolated production preview at `http://127.0.0.1:8002`, so an existing development server cannot affect test results.

Browsers are not bundled. In a fresh checkout, and in the Frappe devcontainer,
install them once before running the browser suite:

```bash
sudo npx playwright install-deps chromium
npx playwright install chromium
```

Run `install-deps` as root and the browser download as the normal user: the
download must land in that user's `~/.cache/ms-playwright`. Skipping this makes
every browser test fail identically at `browserType.launch` with
`Executable doesn't exist`, before any test logic runs.

Run the browser download from the project directory, not a parent. Elsewhere
`npx` resolves a newer Playwright than the one pinned here and downloads a
browser build the test run will not look for.

In the Frappe devcontainer, `node_modules` is shared with the host through the
bind mount, so a native module installed on macOS has no Linux binary and
`vite preview` dies with `Cannot find native binding`. Add the missing platform
build alongside the existing one rather than reinstalling, which would drop the
host's:

```bash
npm pack @rolldown/binding-linux-arm64-gnu@1.0.2
tar -xzf rolldown-binding-linux-arm64-gnu-1.0.2.tgz
mv package node_modules/@rolldown/binding-linux-arm64-gnu
```

Match the version to the installed `rolldown`. The durable fix is to give the
container its own `node_modules` via a volume mount in the devcontainer config,
so host and container never share platform-specific binaries. After assembling `dist/` with `npm run build` or `npm run predeploy`, run:

```bash
npm run test
```

Set `PLAYWRIGHT_BASE_URL` to test an explicitly managed server instead.

The e2e tests cover boot, login, setup wizard completion, Desk stability,
multi-instance creation and rename, scoped reload behavior, IndexedDB
persistence, uploaded files, static assets, and the mobile shell.

Run only the fast protocol contract tests with:

```bash
npm run test:contract
```

Run the Python unit tests, which exercise the MariaDB→SQLite translation against
real ERPNext query shapes on a real SQLite database, and the rapidfuzz
substitute against the contract ERPNext depends on:

```bash
npm run test:python
```

Measure which module mocks are actually required, rather than assuming:

```bash
npm run test:ablate
```

This removes one mock at a time, rebuilds, runs the browser suite, restores the
original file, and writes `artifacts/ablation/report.json`. A mock whose removal
keeps the suite green is dead code; a mock whose removal breaks it has a captured
failure that is the reproduction an upstream report needs. It requires
`artifacts/runtime/` to already exist and takes several minutes per candidate.

Validate runtime hashes, required publish files, absolute and relative worker imports, and source/output boundaries with:

```bash
npm run verify:build
```

Exercise a clean publish build, including stale-output detection, with:

```bash
npm run test:clean-build
```

CI runs the fast tests, clean-build verification, and the complete Chromium Playwright project before publishing.

## Deployment

Build the deployable `dist/` tree without publishing:

```bash
npm run predeploy
```

Deploy to Cloudflare Pages:

```bash
npm run deploy
```

`npm run deploy` also runs `predeploy`, which prepares the runtime and frontend before publishing with `scripts/deploy.sh`.

## Acknowledgements

Frappe Playground is heavily inspired by the amazing foundational work done by the [WordPress Playground](https://github.com/WordPress/wordpress-playground) team in bringing full-stack web applications into the browser via WebAssembly.

## Meet Your Artisans

[LUBUS](https://lubus.in/?utm_source=github&utm_medium=open-source&utm_campaign=frappe-playground) is a web design agency based in Mumbai.

<a href="https://cal.com/lubus">
<img src="https://raw.githubusercontent.com/lubusIN/.github/refs/heads/main/profile/banner.png" />
</a>

## License

Frappe Playground is open-sourced licensed under the [MIT License](LICENSE).
