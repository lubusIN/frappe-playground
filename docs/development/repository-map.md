# Repository map

```text
frappe-playground/
├── docs/                     # this VitePress site
│   └── .vitepress/           # navigation, build target, and theme
├── packages/
│   ├── client/               # Vue shell and orchestration
│   ├── protocol/             # shared cross-context contracts
│   ├── service-worker/       # origin router and asset cache
│   └── server/               # Pyodide worker and WSGI bridge
├── runtime/
│   ├── apps/                 # authored optional-app catalog
│   ├── build/                # Docker runtime builder/exporter
│   ├── config/               # browser Python and site config
│   ├── python/               # WSGI and compatibility Python
│   └── frappe-version.json   # pinned runtime version
├── scripts/                  # build, assembly, validation, deployment
├── static/                   # hosting headers, redirects, favicon
├── tests/
│   ├── contract/             # fast Node tests
│   └── e2e/                  # Playwright browser flows
├── artifacts/                # generated intermediate output (ignored)
└── dist/                     # complete static publish output (ignored)
```

## Client entry points

- `packages/client/index.html`: static shell and legacy-worker recovery.
- `packages/client/src/main.js`: Vue mount.
- `packages/client/src/App.vue`: UI composition and boot-flag coordination.
- `packages/client/src/playground/controller.js`: worker lifecycle and channel wiring.
- `session.js`, `apps.js`, `iframe-navigation.js`: instance, catalog, and scope behavior.

See [Client shell internals](/architecture/client-shell) for the component-to-controller ownership model.

## Service Worker entry points

- `packages/service-worker/src/index.js`: events and routing composition.
- `routing.js`: scope/static classification and Socket.IO compatibility.
- `instance-registry.js`: client, scope, port, and readiness associations.
- `backend-proxy.js`: Fetch-to-protocol translation and response rewriting.
- `cache.js`: content-derived Cache Storage names and fetch behavior.

See [Service Worker internals](/architecture/service-worker) for its full message and Fetch decision trees.

## Server worker entry points

- `packages/server/src/index.js`: boot and message composition root.
- `boot.js`: Pyodide setup.
- `filesystem.js`: runtime manifest and filesystem installation.
- `persistence.js`: IndexedDB snapshots and SQLite lifecycle.
- `request-handler.js`: Python WSGI bridge and serial execution.
- `app-installer.js`: archive verification and Frappe app lifecycle.

See [Server worker internals](/architecture/server-worker) for boot composition, request serialization, and rollback boundaries.

## Protocol entry points

- `messages.js`: versioned message constructors and guards.
- `request.js`: HTTP request/response envelopes.
- `scope-url.js`: scoped path transforms.
- `app-catalog.js`: shared authored/generated catalog validation.
- `version.js`: protocol version.

Each package README states its responsibilities, boundaries, and focused verification commands. Start there before changing a package.
