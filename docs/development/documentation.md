# Documentation maintenance

The documentation should describe behavior proven by the current repository, not generic Frappe or Pyodide expectations.

## Sources of truth

| Subject | Authoritative files |
| --- | --- |
| User UI and boot flags | `packages/client/src/App.vue`, `components/`, `playground/boot-flags.js` |
| Instances and storage | `playground/session.js`, `packages/server/src/persistence.js` |
| Routing and recovery | `packages/service-worker/src/`, `playground/iframe-navigation.js` |
| Messages and URL scopes | `packages/protocol/src/` |
| Frappe/Pyodide behavior | `packages/server/src/`, `runtime/python/`, `runtime/config/` |
| User controls and responsive UI | `packages/client/src/components/`, `packages/client/src/App.vue` |
| App compatibility | `runtime/apps/catalog.json`, generated catalog, app installer |
| Build and deploy | `vite.config.mjs`, `scripts/`, `static/`, CI workflows |
| Verified behavior | `tests/contract/`, `tests/e2e/` |

When prose and implementation disagree, update the behavior or docs intentionally and add a test for the invariant when practical.

## Version-sensitive facts

Avoid duplicating values unless readers need them. When documenting Frappe, protocol, Pyodide CDN, app, timeout, or hosting-limit values, name the source file and update the docs in the same change as that source. The existing runtime-version contract already checks the Frappe declaration against build inputs and `Technical_Notes.md`; docs should be reviewed during that change as well.

## Local authoring

```bash
npm run docs:dev
```

VitePress serves sources from `docs/` with local search and clean URLs. Internal links should be root-relative within the VitePress site (`/architecture/`) or relative to the current page. VitePress applies the production `/docs/` base automatically.

## Build integration

```bash
npm run docs:build
npm run build
npm run verify:build
```

The standalone docs build replaces only `dist/docs`. The combined build first lets playground Vite clean the publish root, assembles runtime sources, then renders docs. Build verification requires `dist/docs/index.html`.

The root Service Worker must continue to treat `/docs` as a static namespace and leave unscoped docs requests to native browser/host fetching. If the docs path changes, update routing, `_redirects`, VitePress `base`, and contract tests together.

The docs use Frappe UI’s native Espresso VitePress theme with Playground-specific monochrome additions in `docs/.vitepress/theme/style.css`. The navigation brand is plain text. The repository logo is read directly from `.github/logo.svg` for the favicon: development middleware serves it at `/docs/logo.svg`, while the production plugin emits the identical file. Do not create a second authored logo copy under `docs/`.

## Refresh UI screenshots

The user guides use screenshots generated from the real playground rather than hand-maintained mockups. Refresh the complete set after changing the dock, first-run notice, instance manager, app manager, Info dialog, responsive breakpoints, or catalog branding:

```bash
npm run docs:screenshots
```

The command regenerates Python source modules, starts a dedicated Vite server on port `4175`, boots Frappe in a fresh Chromium context, waits for the ready state and every catalog icon, captures all documented desktop and mobile states into `docs/public/images/`, and stops the server. A browser exception, missing control, failed app icon, boot timeout, or empty output makes the command fail instead of leaving a silently incomplete refresh.

Requirements and overrides:

- Install Chromium once with `npx playwright install chromium` if it is not already available.
- The default boot needs network access for Pyodide packages and remote app icons.
- Set `DOCS_SCREENSHOT_TIMEOUT` in milliseconds when a cold machine needs more than the default two minutes.
- Set `DOCS_SCREENSHOT_URL` to capture an already-running compatible playground instead of starting a local server. The script still creates a fresh browser context, so it does not reuse personal playground data.

Review changed images before committing them. Screenshot updates can legitimately include runtime timings and the Sites manager’s last-accessed timestamp, but unexpected blank icons, missing rows, clipped dialogs, or fallback avatars indicate a failed capture and should not be accepted.

## Review checklist

- VitePress reports no dead internal links.
- Commands match `package.json` exactly.
- Paths distinguish authored `runtime/` from generated `artifacts/` and `dist/`.
- Limitations clearly separate implemented substitutes from full services.
- Security language does not imply hostile-code isolation.
- Hosting guidance covers origin-root paths, HTTPS, response headers, MIME types, cache policy, and external dependency access.
- UI changes include a reviewed `npm run docs:screenshots` refresh when relevant.
- `npm run test:contract` and `npm run test:clean-build` pass.
