# Service Worker

The Service Worker is the origin-level router between browser requests and the
correct scoped Pyodide server instance. One Service Worker is shared by every
playground tab and instance on the origin.

## Responsibilities

- Route scoped Frappe requests to the matching server worker.
- Maintain client-to-instance associations and runtime readiness.
- Proxy request and response envelopes over `MessageChannel` ports.
- Serve or cache runtime assets without sending them through Python.
- Preserve scopes across same-origin backend redirects.
- Support channel recovery after reloads and Service Worker restarts.
- Provide the small Socket.IO compatibility response required by Frappe.

## Structure

- `src/index.js` is the Service Worker event entry point.
- `src/routing.js` classifies and rewrites request URLs.
- `src/instance-registry.js` tracks instance ports, clients, and readiness.
- `src/backend-proxy.js` translates Fetch requests to protocol messages.
- `src/cache.js` manages versioned runtime asset caching.

## Boundaries

The Service Worker may depend on `packages/protocol`, but it must not import the
client or server implementations. It must never evict other instances merely
because one tab initializes; multiple tabs and playgrounds share this worker.

Static shell, runtime, and development-module requests must bypass the Python
backend. Any new public asset prefix should be added to routing tests.

## Lifecycle notes

`clients.claim()` belongs only in the active worker's `activate` event. Hard
reloads may produce an uncontrolled page with a valid active registration, so
the client can communicate with `registration.active` directly.

## Verification

From the repository root:

```bash
npm run test:contract
npx playwright test tests/e2e/sw_behavior.spec.js --project=chromium
npx playwright test tests/e2e/scoped_reload.spec.js --project=chromium
```
