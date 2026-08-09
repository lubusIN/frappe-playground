# Protocol

The protocol package defines the shared, versioned contracts used by the
client, Service Worker, and Pyodide server worker. It contains no application
or worker lifecycle implementation.

## Responsibilities

- Define protocol message names and runtime progress stages.
- Create and validate control, lifecycle, app-management, request, and response messages.
- Preserve transferable HTTP request and response bodies.
- Add, read, and remove playground scopes in URLs.
- Expose the current protocol version.

## Structure

- `src/messages.js` defines worker messages and validation helpers.
- `src/app-catalog.js` validates optional-app metadata in Node and browser contexts.
- `src/request.js` defines backend request and response envelopes.
- `src/scope-url.js` defines scoped URL parsing and rewriting.
- `src/version.js` contains the protocol version.

## Compatibility rules

Every cross-context message must include the current protocol version. Unknown
or mismatched versions must be rejected rather than interpreted partially.

Changes to an existing message shape require either backward-compatible
parsing or a protocol version increment. Deprecated messages may remain
recognizable while consumers safely ignore them.

## Boundaries

This package must remain dependency-light and environment-neutral. It must not
import client, Service Worker, server, Vue, Pyodide, or browser persistence
implementation modules.

## Verification

Protocol behavior is covered by the contract suite:

```bash
npm run test:contract
```
