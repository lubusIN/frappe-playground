# Protocol contracts

`packages/protocol/` is the only supported coupling between the shell, Service Worker, and server worker.

## Versioning rule

Every message has this outer shape:

```js
{
  protocolVersion: 2,
  type: 'backend:request',
  payload: { /* type-specific fields */ },
}
```

Consumers reject messages whose version or required fields do not match. Existing message shapes must remain backward-compatible or the protocol version must be incremented. Deprecated v2 control messages remain recognizable so they can be safely ignored.

Use `packages/protocol/src/version.js` as the source of truth for the numeric version; the example above reflects the current repository.

## Message families

| Family | Messages | Purpose |
| --- | --- | --- |
| Worker lifecycle | `channel:init`, `channel:close`, `channel:recovery-request` | Transfer, retire, or recreate instance channels |
| Client association | `service-worker:associate-client` | Bind an iframe client to an instance scope |
| Runtime lifecycle | `runtime:log`, `runtime:ready`, `runtime:error` | Structured boot progress and outcome |
| App operations | `app:install`, `app:install-result`, `app:uninstall`, `app:uninstall-result` | Request-correlated catalog mutations |
| HTTP proxy | `backend:request`, `backend:response` | WSGI request and response envelopes |

`service-worker:claim-clients` and `service-worker:clear-other-instances` are deprecated compatibility messages. Activation owns `clients.claim()`, and clearing other instances is unsafe because one Service Worker is shared across tabs.

## HTTP envelope

A backend request contains method, unscoped path, query string, plain header object, and an optional transferable body. A response contains an HTTP status, headers, and body. Constructors validate non-empty strings, object shapes, and the `100–599` status range.

## URL and catalog contracts

The protocol package also owns scoped-URL parsing and optional-app catalog validation. Keeping those rules environment-neutral lets the browser and Node build scripts apply identical validation without importing Vue, Pyodide, or worker lifecycle code.

## Changing the protocol

1. Add or update constructors and validators in `packages/protocol/src/`.
2. Update every producer and consumer deliberately.
3. Preserve transferable objects such as ports and request bodies.
4. Add contract tests for valid, invalid, old, and recovery behavior.
5. Run `npm run test:contract` before browser tests.

Control receivers validate message-specific payloads with `isControlMessage` before reading fields. Channel initialization also requires a transferred MessagePort. Backend readers validate header shapes and text/binary bodies. The envelope-only `isProtocolMessage` predicate remains available; it does not imply payload validity. Protocol version 2 and deprecated message recognition are preserved.
