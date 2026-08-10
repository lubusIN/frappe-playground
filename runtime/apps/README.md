# App catalog

This directory contains the authored catalog for optional Frappe apps that can
be prepared for the browser runtime. Catalog entries are build inputs, not
generated artifacts.

The current compatibility set includes Frappe Wiki, Frappe Vault, and Frappe
CRM. Apps remain marked experimental until their install, reload, primary
route, and uninstall lifecycle passes in the browser runtime.

Each app must use an immutable 40-character Git commit and declare its archive,
asset prefix, package root, and Python dependencies. Validate
catalog changes before starting the longer Docker build:

```bash
npm run validate:apps
```

`npm run build:runtime` clones the pinned source, builds its frontend assets,
and writes generated output to `artifacts/runtime/apps/`. The install archive is
deterministic and excludes compiled public assets; those are published once
under the entry's `assetPrefix`.

The generated catalog records a fingerprint of this authored catalog. Build
verification rejects stale archives after any app recipe, dependency, version,
or source commit changes. After editing `catalog.json`, run:

```bash
npm run build:runtime
npm run build
npm run verify:build
```

The app manager installs and uninstalls these generated archives independently
for each playground.
