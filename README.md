<p align="center"><img width="250" src=".github/logo.svg"></p>

![Frappe Playground](.github/banner.jpg)

# Frappe Playground

Run the Frappe Framework in the browser with Pyodide and WebAssembly. The playground serves a Vue shell, boots Frappe inside a Web Worker, and routes same-origin Frappe requests through a Service Worker into Python WSGI. Runtime state is kept in the browser, so a tab can reload without needing a traditional Python server.

> [!CAUTION]
> Project is currently experimental and under active development.

## Overview

The playground has five main pieces:

1. **Vue shell (`packages/client/`)**: Renders the loading screen, top bar, and Frappe Desk iframe. `packages/client/src/playground/` owns client configuration, runtime lifecycle, session identity, and iframe navigation independently of the Vue components. It depends on the shared protocol, never on server or Service Worker implementation modules. Vite emits the shell assets into `dist/frontend/`.
2. **Service Worker (`packages/service-worker/`)**: A small event entry point delegates scoped routing, caching, instance registration, Socket.IO compatibility, and Python backend proxying to independently testable modules.
3. **Pyodide server (`packages/server/`)**: A small worker entry point composes the Pyodide loader, filesystem installer, IndexedDB persistence, database lifecycle, Python bridge, and serial WSGI request executor. Browser-specific Python sources in `runtime/python/` are converted into a build-time JavaScript text module.
4. **Shared protocol (`packages/protocol/`)**: Defines the versioned messages exchanged by the shell, Service Worker, and Pyodide server.
5. **Runtime build (`runtime/`, `scripts/build.sh`)**: Keeps Python helpers, runtime configuration, the Dockerfile, and asset exporter together, and builds intermediate Frappe runtime artifacts into `artifacts/runtime/`. The application build assembles those artifacts and all authored browser sources into the clean `dist/` publish directory.

The app must be served from `localhost` or HTTPS with cross-origin isolation headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Access-Control-Allow-Origin: *
```

Vite sets these headers during local development and preview. Cloudflare Pages uses the authored `static/_headers` file copied into `dist/` during assembly.

### Default Credentials

The playground preconfigures a streamlined authentication flow for instant experimentation:

The login form is automatically prefilled with username `Administrator` and password `admin` via client-owned configuration in `packages/client/src/playground/config.js`.

## Getting Started

Install dependencies:

```bash
npm install
```

Build the browser runtime with Docker:

```bash
npm run build:runtime
```

Start the local Vite dev server:

```bash
npm run dev
```

Open `http://localhost:5173/`.

For a production-style local preview, build the Vue shell and start Vite preview:

```bash
npm run build
npm start
```

Open `http://localhost:8000/`.

To run the complete deploy preparation flow in one command:

```bash
npm run deploy:prepare
```

This rebuilds the runtime artifacts, builds the frontend shell into a clean `dist/`, assembles the authored runtime files, and checks published asset limits.

## Directory Structure

```text
frappe-playground/
|-- packages/
|   |-- client/             # Vue shell and browser orchestration
|   |-- protocol/src/       # Versioned cross-context message contracts
|   |-- service-worker/src/ # Service Worker routing and proxy modules
|   `-- server/src/         # Pyodide server modules
|-- runtime/
|   |-- python/             # Authored Python bridge helpers and mocks
|   |-- config/             # Python package and site configuration
|   `-- build/              # Dockerfile and runtime asset exporter
|-- static/                 # Authored static hosting files only
|-- artifacts/runtime/      # Generated intermediate runtime artifacts
|-- dist/                   # Generated deployable application
|-- scripts/
|   |-- build.sh            # Docker runtime build
|   |-- check-limits.sh     # Asset size limit verification
|   |-- deploy.sh           # Cloudflare Pages deployment
|   |-- prepare.sh          # Assembles runtime and authored files into dist/
|   `-- prepare-deploy.sh   # Full deploy preparation flow
|-- tests/
|   |-- unit/               # Focused module tests
|   |-- contract/           # Fast protocol and MessageChannel tests
|   `-- e2e/                # Playwright browser flows
|-- vite.config.mjs
`-- playwright.config.js
```

`artifacts/` and `dist/` are generated and intentionally ignored by Git. Authored source files never live in either directory.

Application code may import shared contracts from `packages/`, but applications must not import implementation modules from sibling applications. Build scripts are responsible for mapping authored application entry points to their stable public URLs in `dist/`.

## Testing

The Playwright suite starts and owns an isolated production preview at `http://127.0.0.1:8002`, so an existing development server cannot affect test results. After assembling `dist/` with `npm run build` or `npm run deploy:prepare`, run:

```bash
npm run test
```

Set `PLAYWRIGHT_BASE_URL` to test an explicitly managed server instead.

The e2e tests cover boot, login, setup wizard completion, Desk stability, scoped reload behavior, and the mobile shell.

Run only the fast protocol contract tests with:

```bash
npm run test:contract
```

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
npm run deploy:prepare
```

Deploy to Cloudflare Pages:

```bash
npm run deploy
```

`npm run deploy` also runs `predeploy`, which prepares the runtime and frontend before publishing with `scripts/deploy.sh`.

## Meet Your Artisans

[LUBUS](https://lubus.in/?utm_source=github&utm_medium=open-source&utm_campaign=frappe-playground) is a web design agency based in Mumbai.

<a href="https://cal.com/lubus">
<img src="https://raw.githubusercontent.com/lubusIN/.github/refs/heads/main/profile/banner.png" />
</a>

## License

Frappe Playground is open-sourced licensed under the [MIT License](LICENSE).
