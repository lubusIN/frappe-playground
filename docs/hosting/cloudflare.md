# Deploy to Cloudflare Pages

The repository’s supported deployment script targets Cloudflare Pages and publishes the complete `dist/` directory.

## Authenticate and deploy

Build and deploy in one command:

```bash
npm run deploy
```

The script runs `predeploy`, then executes:

```bash
npx wrangler pages deploy dist \
  --project-name="$CLOUDFLARE_PAGES_PROJECT" \
  --branch="$CLOUDFLARE_PAGES_BRANCH"
```

The environment variables are optional. The project defaults to `frappe-playground`, and the branch defaults to the current Git branch (or `main` if it cannot be determined). `CLOUDFLARE_ACCOUNT_ID` is passed when set.

For interactive local use, Wrangler can authenticate through its normal login flow. In CI, provide Cloudflare credentials using your CI provider’s secrets mechanism rather than committing them.

## Cloudflare build configuration

If Cloudflare Pages builds from Git, use:

| Setting | Value |
| --- | --- |
| Build command | `npm run predeploy` |
| Build output directory | `dist` |
| Root directory | repository root |

The build environment must provide a working Docker daemon because a clean runtime build runs `runtime/build/Dockerfile`. If the managed build environment cannot run Docker, build `dist/` in CI that can and deploy it with Wrangler.

## Headers and redirects

The assembly copies `static/_headers` and `static/_redirects` to the publish root. `_headers` applies cross-origin isolation to the entire site and disables caching for mutable runtime entry modules. `_redirects` normalizes `/docs` to `/docs/` and sends remaining SPA routes to the playground shell.

Do not remove the isolation headers. Pyodide and the browser runtime depend on a cross-origin-isolated page. Also verify that third-party assets loaded into the page are compatible with the page’s embedder policy.

## One deployment, two sites

The final artifact has this shape:

```text
dist/
├── index.html             # playground shell
├── sw.js                  # origin-level request router
├── frontend/              # shell bundles
├── assets/ and storage/   # prepared Frappe runtime
├── docs/                  # VitePress output
├── _headers
└── _redirects
```

Because the Service Worker is registered from `/sw.js`, it sees requests across the origin. The router classifies `/docs` as static for redirect decisions and explicitly leaves unscoped documentation requests to the browser and host. This avoids sending docs into Frappe or tying docs releases to the runtime asset cache.

## Repository CI behavior

The checked-in deploy workflow uses Node.js 22, restores `artifacts/runtime` from a GitHub Actions cache, runs `predeploy`, contract tests, clean-build verification, installs Chromium, and runs the Chromium integration suite before invoking `cloudflare/wrangler-action` against `dist`.

Pull requests from the same repository can receive a Pages preview; the workflow writes the deployment URL to the job summary and updates a marker-delimited section of the PR description. Fork pull requests do not publish because they do not receive deployment secrets. The nightly workflow runs the same preparation and Chromium path without publishing.

The runtime cache key is an optimization, not validation. `predeploy` and `verify:build` still check the generated catalog fingerprint and published runtime hashes. If runtime build inputs change outside the workflow cache key, bump the key inputs or force a cache miss so CI does not reuse an inappropriate artifact directory.
