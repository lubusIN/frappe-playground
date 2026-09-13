# Contributor setup

Most shell, protocol, and routing work needs only Node.js. Rebuilding Frappe or optional apps also needs Docker.

## Install and start

```bash
npm install
npm run build:runtime
npm run dev
```

`build:runtime` is required when `artifacts/runtime/` is absent or its inputs changed. It is expensive because Docker prepares Frappe, its browser-compatible dependencies, static assets, a seed database, and catalog app packages. Client-only development can reuse existing artifacts.

The playground dev server runs at `http://localhost:5173/` and supplies both authored source modules and generated runtime files through Vite middleware. The same command starts VitePress on an internal companion port and proxies `http://localhost:5173/docs/`, matching the production URL layout.

To run only the documentation server:

```bash
npm run docs:dev
```

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run generate:sources` | Convert authored Python helpers into the worker-imported JS module |
| `npm run dev` | Regenerate Python sources and start the playground plus proxied docs |
| `npm run dev:playground` | Start only the playground Vite server |
| `npm run docs:dev` | Start the VitePress documentation server |
| `npm run docs:screenshots` | Regenerate documented UI states from the real playground in Chromium |
| `npm run build:runtime` | Validate apps and rebuild Docker-produced runtime artifacts |
| `npm run build:playground` | Build and assemble only the root playground output |
| `npm run docs:build` | Add documentation under `dist/docs` without clearing the root output |
| `npm run build` | Build the playground and docs into one `dist/` tree |
| `npm run predeploy` | Prepare, size-check, and verify the full publish artifact |
| `npm run test:contract` | Run fast Node contract tests |
| `npm run test:e2e:chromium` | Run the browser integration suite in Chromium |

## Source boundaries

Keep client, Service Worker, and server worker implementations independent. Their public connection is the protocol package. Put browser-Python sources under `runtime/python`, runtime recipes/config under `runtime`, and generated output only under ignored `artifacts/` or `dist/`.

The inline recovery code in `packages/client/index.html` is an intentional exception to the normal Vue entry path: it must run when an old Service Worker prevents the main bundle from loading.

## Before opening a change

At minimum, run the tests nearest your edit. For routing or protocol changes, run all contract tests. For persistence or UI lifecycle changes, also run the focused Playwright spec. For a release or build-system change, run:

```bash
npm run predeploy
npm run test:contract
npm run test:clean-build
npm run test:e2e:chromium
```

See [Testing](./testing) for the test-to-feature map.
