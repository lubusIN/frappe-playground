# Testing

Tests are split by the browser boundary they cross.

## Contract tests

```bash
npm run test:contract
```

Node’s built-in test runner covers protocol validation, URL scopes, Service Worker routing and caching, backend envelopes, instance catalogs, runtime version consistency, app-catalog recipes, and server modules. The command regenerates Python sources first.

Run this suite for nearly every code change; it is fast and does not boot Pyodide in a browser.

## Clean-build verification

```bash
npm run test:clean-build
npm run verify:build
```

These commands catch stale output, missing publish files, broken worker imports, catalog/archive hash mismatches, and generated files placed in the wrong directory.

## End-to-end tests

```bash
npm run test:e2e:chromium
npm run test:e2e:webkit
```

Playwright owns a production preview at `http://127.0.0.1:8102` unless `PLAYWRIGHT_BASE_URL` points to an externally managed deployment. The per-test timeout is ten minutes because a cold Pyodide/Frappe boot is substantial. Traces and screenshots are retained under `tests/results/`.

Focused specs cover:

| Area | Spec |
| --- | --- |
| Basic boot and progress | `boot.spec.js`, `full_flow.spec.js` |
| Login and Setup Wizard | `login.spec.js`, `setup_wizard.spec.js`, `boot_flags.spec.js` |
| Desk and app lifecycle | `desk.spec.js`, `app_install.spec.js` |
| Persistence and files | `cache_persistence.spec.js`, `file_upload.spec.js` |
| Multiple instances | `multi_instance.spec.js` |
| Routing and recovery | `scoped_reload.spec.js`, `scope_escape.spec.js`, `shell_recovery.spec.js`, `sw_behavior.spec.js` |
| Static output and mobile UI | `static_files.spec.js`, `mobile_shell.spec.js` |

## Complete suite

```bash
npm test
```

This runs contract tests, a clean build, and both configured Playwright projects. For quicker iteration, build once and select the smallest relevant spec with `npx playwright test tests/e2e/<name>.spec.js --project=chromium`.

## Python mock audit

```bash
npm run test:mock-removal
```

This probes whether compatibility mocks can be removed. Use `npm run test:mock-removal:list` to list candidates. A mock’s presence is not proof that current Frappe requires it; document a failing import or flow before treating it as a runtime dependency.
