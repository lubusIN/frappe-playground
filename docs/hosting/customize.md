# Customize the playground

Customization falls into four layers: shell presentation, browser orchestration, Frappe runtime configuration, and runtime/app artifacts. Choose the shallowest layer that achieves the result.

## Brand and shell UI

The Vue application lives in `packages/client/`:

- `src/App.vue` composes the loading state, iframe, dock, and dialogs.
- `src/components/` contains presentation components.
- `src/style.css` contains global styling.
- `index.html` contains the static loading shell and an inline recovery watchdog that must run even when a stale Service Worker blocks module loading.
- `src/playground/config.js` contains the prefilled demo login presentation defaults.

Client code may import `packages/protocol`, but should not import Service Worker or server implementation modules directly.

## Change site defaults

`runtime/config/site.js` generates `site_config.json`. The current runtime sets SQLite, developer mode, disabled CSRF checks and telemetry, a paused scheduler, and disabled async behavior.

These are browser compatibility and demo settings. Changing them does not conjure the missing infrastructure: enabling async work, for example, does not provide Redis Queue workers.

`runtime/config/packages.js` declares Python packages installed during Pyodide boot. A package must be installable in Pyodide. Native wheels built for ordinary Linux are not automatically compatible with WebAssembly.

After changing runtime configuration, regenerate and verify a full build:

```bash
npm run build:runtime
npm run build
npm run verify:build
```

## Change the Frappe version

The pinned version is declared in `runtime/frappe-version.json` and consumed by the Docker runtime build. Version references in `Technical_Notes.md`, build scripts, and tests are deliberately checked for agreement.

A version bump is compatibility work, not only a manifest edit. Rebuild the runtime, review browser shims and SQLite behavior, and run contract plus end-to-end tests. Optional-app version constraints and pinned commits may also need changes.

## Add an app to the catalog

Edit `runtime/apps/catalog.json`. An entry defines:

- a stable ID, title, description, version, and license;
- an immutable 40-character source commit;
- the supported Frappe version range;
- archive URL, asset prefix, package root, and excluded archive paths; and
- Python dependencies that can be installed in the browser runtime.

Start with the fast schema check:

```bash
npm run validate:apps
```

Then build the runtime. The Docker process clones the pinned source, compiles its frontend, creates a deterministic install archive, publishes assets under the declared prefix, and generates integrity metadata:

```bash
npm run build:runtime
npm run build
npm run verify:build
```

Test install, reload, the app’s primary route, persistence, and uninstall. Keep the app marked experimental until that lifecycle works reliably.

## Change routing or worker messages

Cross-context behavior belongs in `packages/protocol`. Message-shape changes must remain backward-compatible or increment the protocol version. New public asset prefixes must be classified as static by the Service Worker and covered by routing contract tests.

Run `npm run test:contract` after every routing or protocol change, followed by the relevant Playwright flows.

## Customize these docs

Documentation sources live in `docs/`; VitePress configuration and theme overrides live in `docs/.vitepress/`. Run:

```bash
npm run docs:dev
```

The documentation base is `/docs/`, and a production docs build writes only into `dist/docs`, leaving the assembled playground files around it intact.
