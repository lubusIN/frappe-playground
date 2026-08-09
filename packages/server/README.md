# Server

The server package runs Frappe inside a dedicated Web Worker using Pyodide. It
acts as an in-browser WSGI server and persists each playground independently in
IndexedDB.

## Responsibilities

- Load Pyodide and required Python packages.
- Install the generated Frappe runtime filesystem.
- Seed or restore the scoped site database and uploaded files.
- Verify and unpack catalog app archives, install their schema, and restore them on boot.
- Configure the Python WSGI bridge and browser-specific Frappe mocks.
- Execute backend requests serially.
- Persist database, cookies, and site files after mutations.
- Report structured boot progress and runtime errors to the client.

## Structure

- `src/index.js` is the server worker entry point and composition root.
- `src/boot.js` loads Pyodide and Python packages.
- `src/app-installer.js` owns catalog loading, archive verification, and Frappe installation.
- `src/filesystem.js` installs runtime assets and filesystem content.
- `src/persistence.js` owns scoped IndexedDB state and database lifecycle.
- `src/request-handler.js` bridges protocol requests to Python WSGI.
- `src/config.js` exposes build-generated runtime and site configuration.

Python bridge sources live in `runtime/python/` and are converted into
`generated/python-sources.js` during the build. Runtime configuration belongs
in `runtime/config/`; generated runtime artifacts belong in
`artifacts/runtime/`, never in this source package.

## Instance isolation

The worker receives its scope and freshness through its entry URL. Persistent
site state, cookies, uploaded files, and installed-app metadata are stored in
`frappe_playground_db_<scope>`. Resetting or deleting
one playground must affect only that database, not the shared Pyodide runtime
cache or another playground's state.

## Boundaries

The server may import `packages/protocol` contracts and generated/runtime
inputs, but it must not import client or Service Worker implementation modules.
Browser requests reach it only through a transferred `MessagePort`.

## Verification

From the repository root:

```bash
npm run generate:sources
npm run test:contract
npx playwright test tests/e2e/cache_persistence.spec.js --project=chromium
npx playwright test tests/e2e/file_upload.spec.js --project=chromium
```
