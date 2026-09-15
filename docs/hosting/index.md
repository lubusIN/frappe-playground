# Self-host Frappe Playground

The deployed playground is static output: HTML, JavaScript workers, prepared Python packages, a seed SQLite database, Frappe assets, and optional-app archives. No origin server executes Frappe.

## Requirements

You need:

- Node.js and npm for the shell and documentation builds.
- Docker for building the Frappe runtime artifacts.
- A static host that supports custom response headers, clean URLs, Service Workers, large assets, and correct MIME types for JavaScript, WebAssembly, JSON, archives, fonts, and compressed files.
- HTTPS on the public origin.
- Browser access to the configured Pyodide CDN and Python package sources, unless you deliberately vendor and reconfigure those dependencies.

## Build the publish directory

```bash
git clone https://github.com/lubusIN/frappe-playground.git
cd frappe-playground
npm install
npm run predeploy
```

`predeploy` validates the app catalog, builds runtime artifacts with Docker when they are missing, builds the Vue shell and this documentation, checks asset size limits, and verifies the assembled output. The complete publish directory is `dist/`; documentation is under `dist/docs/`.

For a production-style local preview:

```bash
npm start
```

The root app opens on the preview server and the documentation opens at `/docs/`.

## Required headers

Every response served by the static host needs these isolation headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Access-Control-Allow-Origin: *
```

The authored `static/_headers` file supplies them for Cloudflare Pages and is copied to `dist/_headers`. Vite supplies the same headers in local development and preview. Responses synthesized by the backend proxy add the COOP, COEP, and CORP headers themselves.

Runtime entry modules and their source modules are also published with `no-store` rules so a shell update cannot accidentally load an incompatible mix. Large immutable Frappe assets use a separate content-derived Service Worker cache.

## URL layout

The application assumes it owns the origin root. Important paths include `/sw.js`, `/worker.js`, `/frontend/`, `/assets/`, `/storage/`, `/apps/`, `/protocol/`, `/server/`, and `/service-worker/`. Frappe itself contains root-relative paths, so mounting the playground application below a prefix is not supported by the current runtime.

The docs are the exception: VitePress is built with `/docs/` as its base and can be served beside the root application.

## Validate a host

After deployment, confirm that:

1. `/` returns the shell and `/docs/` returns this site.
2. `crossOriginIsolated` is `true` in the browser console on the playground.
3. `/sw.js` has JavaScript MIME type, the isolation headers, and no long-lived cache.
4. a new instance reaches the login or Setup Wizard;
5. a reload restores the same instance; and
6. uploaded files still open after a reload.

Use [Troubleshooting](/guide/troubleshooting) for failure signatures and [Security and trust boundaries](/architecture/security) before exposing a customized build publicly.
