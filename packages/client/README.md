# Client

The client package is the browser-facing Vue shell for Frappe Playground. It
renders boot progress, owns the playground iframe, and coordinates lifecycle
events between the page, Service Worker, and Pyodide server worker.

## Responsibilities

- Render the loading screen, top bar, dialogs, and Frappe iframe.
- Create, select, rename, reset, and delete local playground instances.
- Load the curated app catalog and manage apps in the active playground.
- Register the Service Worker and start the selected server worker.
- Establish the `MessageChannel` connecting those two workers.
- Translate iframe navigation between visible Frappe paths and scoped paths.
- Recover from legacy Service Workers that prevent the client shell loading.

## Structure

- `index.html` provides the static loading shell and inline pre-bundle recovery.
- `src/main.js` mounts the Vue application.
- `src/App.vue` composes UI state and the playground controller.
- `src/components/` contains presentation components.
- `src/playground/controller.js` owns worker lifecycle and channel wiring.
- `src/playground/apps.js` loads and validates the published app catalog.
- `src/playground/session.js` owns the persistent instance catalog.
- `src/playground/iframe-navigation.js` owns scoped iframe URL conversion.
- `src/playground/runtime-version.js` builds versioned worker entry URLs.

## Boundaries

The client may import shared contracts from `packages/protocol`. It must not
import implementation modules from `packages/service-worker` or
`packages/server`. Cross-context behavior must be expressed through the shared
protocol.

The recovery watchdog in `index.html` intentionally remains inline. It must be
able to run when a stale Service Worker prevents `src/main.js` from loading.

## Verification

From the repository root:

```bash
npm run build
npm run test:contract
npx playwright test tests/e2e/boot.spec.js --project=chromium
npx playwright test tests/e2e/multi_instance.spec.js --project=chromium
```
