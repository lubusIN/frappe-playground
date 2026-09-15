# Build system

The build has two layers: a Docker-produced runtime and a Vite-produced application. VitePress adds the documentation after the root app is assembled.

## Runtime artifacts

`npm run build:runtime` performs this pipeline:

1. validate `runtime/apps/catalog.json`;
2. build `runtime/build/Dockerfile` with the Frappe version from `runtime/frappe-version.json`;
3. extract prepared output into `artifacts/runtime/`;
4. unpack built frontend assets;
5. generate `artifacts/runtime/manifest.json` with sizes and hashes; and
6. report hosting size limits.

The runtime directory includes `frappe_runtime.tar.gz`, `site1.db`, asset manifests/files, catalog app archives, and their generated catalog. These are build outputs and must not be hand-edited. See [Runtime build pipeline](/architecture/runtime-build) for the Docker toolchain, pruning rules, deterministic app archives, and cache invalidation boundary.

## Generated Python source

`scripts/generate-python-sources.mjs` turns `runtime/python/*.py` into `artifacts/generated/python-sources.js`. The server worker imports those strings statically and evaluates them during bridge setup. Both development and production builds regenerate this file.

## Playground application

`npm run build:playground` runs Vite with `packages/client/` as its root. Vite writes the Vue shell into a clean `dist/` and assigns frontend bundles to `dist/frontend/`.

`scripts/prepare.sh` then assembles the runtime:

- runtime packages and the seed DB → `dist/storage/`;
- optional app catalog/archives → `dist/apps/`;
- Frappe assets → `dist/assets/`;
- stable worker entries → `dist/sw.js` and `dist/worker.js`;
- authored worker/protocol/config modules → their public directories; and
- hosting metadata → the publish root.

Some source imports are rewritten during copying so monorepo-relative paths become stable root URLs.

## Runtime build identity

`vite.config.mjs` hashes protocol, server, Service Worker, runtime config, generated Python, and the runtime manifest into a short build ID. Client-created worker entry URLs include it, preventing stale worker entry points from silently pairing with a different runtime.

## Documentation

`npm run docs:build` runs after the playground assembly. VitePress has `base: '/docs/'` and uses `dist/docs` as its output directory, so its cleanup is contained below the already assembled runtime.

## Verification

`npm run verify:build` checks required publish paths—including the docs entry—runtime sizes and SHA-256 hashes, app-catalog freshness, authored worker import resolution, and source/output boundaries.

`npm run test:clean-build` places a sentinel in `dist/`, invokes the full build, and proves Vite cleaned stale root output while the later docs build preserved the valid application artifact.
