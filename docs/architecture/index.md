# System architecture

Frappe Playground turns a static website into a local full-stack Frappe environment by distributing responsibilities across three browser execution contexts.

## Components

| Context | Source | Responsibility |
| --- | --- | --- |
| Window | `packages/client/` | Vue UI, instance catalog, lifecycle orchestration, iframe navigation, app operations |
| Service Worker | `packages/service-worker/` | Origin-wide routing, instance association, runtime asset caching, request proxying, redirect/body rewriting |
| Dedicated worker | `packages/server/` | One Pyodide/Frappe runtime per active instance, WSGI execution, SQLite and file persistence, app lifecycle |
| Shared modules | `packages/protocol/` | Versioned messages, HTTP envelopes, app-catalog validation, scoped URL helpers |
| Build inputs | `runtime/` | Python bridge code, compatibility shims, site/package configuration, Frappe and app recipes |

## Runtime topology

```text
Top-level Vue shell
  ├─ localStorage: instance catalog and active instance
  ├─ iframe: Frappe-rendered UI
  ├─ Service Worker registration at /sw.js
  └─ dedicated server worker for the active instance
          ├─ Pyodide
          ├─ Frappe WSGI
          ├─ in-memory filesystem + SQLite
          └─ IndexedDB: frappe_playground_db_<instance-id>

Service Worker (shared by the origin)
  ├─ browser client → instance association
  ├─ instance → transferred MessagePort
  └─ Cache Storage for immutable runtime assets
```

The shell creates a `MessageChannel`. One port is transferred to the Service Worker and the other to the dedicated worker. That direct channel carries proxied HTTP requests without routing large bodies through the Vue component tree.

## The key illusion

Frappe believes it serves a site named `site1`. Browser users see the real playground origin and ordinary routes. Internally, iframe requests are prefixed with `/scope:<instance-id>/`; the Service Worker removes the scope before WSGI execution, sets `X-Frappe-Site-Name: site1`, and restores scope information in redirects and HTML behavior.

This is why multiple local sites can coexist on one origin even though each in-browser Frappe process uses the same virtual site name.

## Architectural boundaries

- The client, Service Worker, and server worker may depend on the protocol package.
- They must not import one another’s implementation modules.
- Every cross-context message carries the current protocol version.
- One Service Worker serves all tabs and instances; initializing one instance must not evict the others.
- Authored source stays outside `artifacts/` and `dist/`; those directories are generated.

Continue with [Boot lifecycle](./boot-lifecycle) or follow a request through [Requests and routing](./routing).

## Read the internals in order

For a code-level understanding, follow the ownership chain before the data flows:

1. [Client shell](./client-shell) — Vue composition, controller ownership, iframe synchronization, app request correlation, and disposal.
2. [Service Worker](./service-worker) — ephemeral registry, Fetch decision tree, recovery, caching, and response rewriting.
3. [Server worker](./server-worker) — Pyodide state, WSGI execution, request serialization, persistence, and app transaction boundaries.
4. [Requests and routing](./routing) — the end-to-end HTTP path and scoped navigation illusion.
5. [Persistence and isolation](./persistence) — the three distinct browser storage layers.
6. [Protocol contracts](./protocol) — versioned messages shared across execution contexts.
7. [Python and Frappe runtime](./runtime) and [Runtime build pipeline](./runtime-build) — what executes and how it is prepared.
8. [Security and trust boundaries](./security) — what isolation does and does not promise.
