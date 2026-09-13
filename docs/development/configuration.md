# Configuration reference

This page maps supported build/runtime knobs to their source. There is no single public configuration object and no stable JavaScript embedding API; customization currently happens through source files, environment variables, and URL flags.

## User-facing URL flags

`packages/client/src/playground/boot-flags.js` implements `name`, `apps`, `login`, `onboarding`, and `path`. See [Boot flags](/guide/boot-flags) for URL usage and semantics.

## Shell defaults

`packages/client/src/playground/config.js` controls login-form prefilling and demo credentials. Worker lifecycle defaults live in `PlaygroundController`:

| Setting | Default |
| --- | --- |
| Service Worker entry | `/sw.js` plus runtime build ID |
| Server worker entry | `/worker.js` plus runtime build ID |
| Recovery channel | `sw-recovery` |
| Service Worker registration timeout | 15 seconds |
| Service Worker upgrade timeout | 30 seconds |
| Ready-event UI delay | 2 seconds |
| App install/uninstall result timeout | 10 minutes |

The controller constructor accepts overrides for testing and derived clients, but this is an internal module API without a compatibility guarantee.

## Server runtime

| Source | Controls |
| --- | --- |
| `runtime/frappe-version.json` | Frappe version consumed by the runtime build |
| `runtime/config/site.js` | Generated `site_config.json` |
| `runtime/config/packages.js` | Packages passed to browser `micropip` |
| `packages/server/src/boot.js` | Pyodide CDN base and core Pyodide packages |
| `packages/server/src/config.js` | Bench directory skeleton and re-exported generated config |
| `runtime/apps/catalog.json` | Curated app recipes and compatibility metadata |

`FRAPPE_VERSION` can override the Docker build argument when invoking `scripts/build.sh`, but using a value different from the declared version can violate repository version-consistency assumptions. Update the declaration and checked references for a maintained version change.

## Development servers

| Server | Port behavior |
| --- | --- |
| Playground Vite dev | `5173`, strict |
| Playground Vite preview | starts at `8000`, may choose another free port |
| Documentation screenshot capture | `4175` by default; override with `DOCS_SCREENSHOT_PORT` |
| Playwright-owned preview | `8102` through `npm run test:serve` |
| VitePress dev/preview | VitePress defaults unless CLI options are supplied |

Both playground Vite modes apply the required cross-origin isolation headers. VitePress development is for docs rendering and does not boot the playground runtime.

## Deployment environment

`scripts/deploy.sh` reads:

| Variable | Meaning |
| --- | --- |
| `CLOUDFLARE_PAGES_PROJECT` | Pages project, default `frappe-playground` |
| `CLOUDFLARE_PAGES_BRANCH` | Deployment branch, default current Git branch or `main` |
| `CLOUDFLARE_ACCOUNT_ID` | Optional explicit Cloudflare account |

Authentication is provided through Wrangler’s supported environment/login mechanisms; the script does not read an API token explicitly.

## Hosting metadata

- `static/_headers` defines isolation and worker/module cache rules.
- `static/_redirects` normalizes `/docs` and supplies the playground SPA fallback.
- `vite.config.mjs` defines stable development/runtime paths, public output layout, build identity, and dev/preview headers.
- `docs/.vitepress/config.mjs` defines the `/docs/` base and `dist/docs` output.

## Build-size policy

`scripts/check-limits.sh` currently enforces at most 20,000 uploadable files and 25 MiB per uploadable file, mirroring the repository’s expected Cloudflare Pages constraints. Hosting limits can change; treat the script as the build’s enforceable policy and verify current platform limits before changing it.
