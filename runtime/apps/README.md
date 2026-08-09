# App catalog

This directory contains the authored catalog for optional Frappe apps that can
be prepared for the browser runtime. Catalog entries are build inputs, not
generated artifacts.

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

Phase 1 only prepares and publishes app artifacts. Installing an app into an
individual playground and exposing app management in the client belong to the
following phases.
