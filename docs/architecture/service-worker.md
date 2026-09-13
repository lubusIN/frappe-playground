# Service Worker internals

The module Service Worker is the only component that sees every same-origin network request. It is both an instance router and a compatibility boundary between browser navigation and Frappe’s origin-root assumptions.

## Owned state

One `InstanceRegistry` lives for the lifetime of the Service Worker global. It holds:

- scope → `{ port, ready, clientId }` runtime records; and
- browser client ID → instance scope associations.

This state is intentionally ephemeral. A browser may terminate the Service Worker at any time, so correctness cannot depend on the map surviving. Registering the same scope again replaces its previous runtime record. Deprecated “clear other instances” messages are ignored because one worker serves all tabs.

## Installation and activation

The `install` event calls `skipWaiting()`. The active worker calls `clients.claim()` only from `activate`; a waiting worker is not allowed to claim clients. The shell’s controller-change logic coordinates the resulting page reload.

## Message handling

The worker accepts only messages matching the current protocol version:

- `service-worker:associate-client` updates a client mapping;
- `channel:init` registers the transferred server-worker port and watches it for `runtime:ready`; and
- deprecated claim/clear messages are logged and ignored.

The runtime’s ready message travels both to the shell and over its Service Worker port. Only the latter marks the registry entry ready for Fetch routing.

## Fetch decision tree

For each request:

1. cache eligible jsDelivr `/pyodide/` responses;
2. ignore other cross-origin traffic;
3. let unscoped `/docs`, shell HTML/frontend files, and development paths fetch natively;
4. cache or remap known runtime static paths;
5. decide whether an unscoped top-level `/` navigation is the Vue shell;
6. resolve an instance scope; and
7. route Socket.IO compatibility or proxy into WSGI.

Scope resolution is ordered: explicit URL scope, registry association for the requesting client, scope parsed from the client’s own URL, then the only active instance when there is exactly one. The last fallback is deliberately disabled when multiple instances make the destination ambiguous.

Associations are recorded for both `event.clientId` and `event.resultingClientId`, which is important across navigations that replace the browser client.

## Empty-registry recovery

If no scope exists and the registry is empty, the worker broadcasts `channel:recovery-request`. It waits five seconds for exactly one active scope to re-register. After timeout:

- navigation redirects to `/?path=<original path and query>` so the shell can reboot and resume; and
- non-navigation returns `503 Runtime connection unavailable` with `Retry-After: 1`.

Once a scope is known, backend dispatch waits up to 90 seconds for its runtime-ready flag. Failure returns a separate `503 Runtime instance did not become ready` response.

## Runtime asset cache

`RuntimeAssetCache` fetches cache-busted `assets/assets.json` and `apps/catalog.json`, concatenates their text, and hashes it with the repository’s lightweight string hash. That value names `frappe-assets-<hash>`. Older caches with that prefix are removed.

Reads are cache-first. Successful and opaque responses are cloned into the cache. If the identity manifests cannot be fetched, the worker logs a warning and uses `frappe-assets-fallback`. Documentation bypasses this cache so docs-only deployments update independently.

## Backend response adaptation

The backend proxy uses one response `MessageChannel` per HTTP request. It injects the virtual site header, translates response headers, scopes eligible redirects, rewrites `site1` URLs in textual bodies, and injects the earliest possible HTML bootstrap script. `Content-Length` is removed whenever rewriting changes the body.

The bootstrap re-associates its browser client after controller changes and page restores. It scopes programmatic `fetch`, XHR, `window.open`, and selected new-tab anchors while leaving fragments, `mailto`, `tel`, JavaScript, data, blob, and unrelated external origins alone.
