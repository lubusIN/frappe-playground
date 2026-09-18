# Requests and routing

The Service Worker decides whether each request belongs to static hosting, the Vue shell, the Socket.IO compatibility layer, or a scoped Frappe instance.

## Scoped paths

An internal Frappe URL has this form:

```text
/scope:<instance-id>/app/todo?status=Open
```

The protocol helpers validate, add, remove, and decode this prefix. A legacy `__scope` query parameter is still recognized but removed from forwarded URLs.

The visible iframe page installs a small bootstrap script. It reassociates its Service Worker client with the instance after page lifecycle events, rewrites `fetch`, `XMLHttpRequest`, `window.open`, and selected new-tab links to keep the scope, then replaces the iframe history URL with its unscoped form.

## Static bypass

Requests for the shell and prepared runtime never cross into Python. Current static prefixes include `/apps`, `/assets`, `/frontend`, `/generated`, `/protocol`, `/pyodide`, `/runtime-config`, `/service-worker`, `/server`, and `/storage`. Development-only Vite paths are also bypassed.

Frappe references some runtime modules below `/assets/frappe/node_modules/`; routing remaps these to the deploy-safe `/assets/frappe/runtime_modules/` path.

## Backend proxy

For a Frappe request, the Service Worker:

1. finds the explicit path scope or the client’s associated instance;
2. strips the scope and creates a versioned HTTP request envelope;
3. sets `X-Frappe-Site-Name: site1`;
4. transfers the request body over a one-shot `MessageChannel` to the instance worker;
5. receives status, headers, and body from the serial WSGI executor; and
6. returns a browser `Response` with isolation headers.

The body is transferred only for methods other than `GET` and `HEAD`.

## Response rewriting

Frappe may emit absolute links for its virtual hostname. Text, JSON, and JavaScript bodies replace `http(s)://site1` and protocol-relative variants with the real origin plus instance scope. HTML receives the bootstrap script described above.

Same-origin redirects are scoped unless they point to a static path. Redirects to the virtual `site1` host are translated back to the playground origin; unrelated external redirects are left unchanged.

## Realtime compatibility

Desk starts an Engine.IO/Socket.IO client during normal boot, but the playground has no realtime server. The Service Worker provides a minimal handshake, namespace acknowledgement, ping behavior, and disconnect handling to prevent a reconnect loop. It does not deliver Frappe realtime events.

## Request ordering

The worker runs WSGI requests serially. Each request waits for an app mutation already in progress, and persistence runs after handling. This avoids concurrent modifications of one Pyodide filesystem and SQLite connection state.
