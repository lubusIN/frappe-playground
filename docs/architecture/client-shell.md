# Client shell internals

The client is a Vue 3 application that owns presentation and orchestration. It never executes Frappe directly and does not proxy backend requests itself.

## Composition root

`packages/client/src/main.js` mounts `App.vue`. The root component owns four groups of state:

- five-stage boot progress and errors;
- iframe source and displayed address;
- instance catalog and active instance;
- optional-app catalog, installed IDs, and pending operations.

Presentation remains in `src/components/`. Runtime lifecycle code lives in `src/playground/` so it can be contract-tested without rendering Vue.

## Controller lifecycle

`PlaygroundController` is an event emitter with `progress`, `ready`, `error`, `waking_up`, and `woke_up` events. `start()` is idempotent while running and proceeds in this order:

1. resolve or create the requested session;
2. register and validate the build-versioned Service Worker;
3. create a dedicated module worker with scope/freshness query parameters;
4. transfer a new channel to the two workers; and
5. open recovery listeners.

The controller records installed app IDs only after `runtime:ready`. A second ready message means a recovered channel and emits `woke_up` instead of repeating initial readiness.

`dispose()` is the ownership boundary. It clears timers, rejects pending app operations, terminates the dedicated worker, closes the BroadcastChannel, removes lifecycle listeners, and clears event subscribers. Switching instances always disposes the old controller first.

## Service Worker upgrade handling

Worker URLs include a source-derived `build` query parameter. The controller accepts a matching page controller or active registration. If an older script controls the page, it waits for a controller change rather than sending current protocol messages to it.

The first controller transition during initial install/legacy upgrade is expected. A later transition triggers one guarded top-level reload so the Vue shell and origin worker move releases together. On every return to a visible tab, the controller calls `registration.update()` and transfers a fresh channel; update errors are logged but do not block the active runtime.

## App operation correlation

Install and uninstall calls validate the app ID, require a ready runtime, generate a UUID when Web Crypto provides one (with a time/random fallback), and store promise handlers by request ID. Result messages settle only their matching promise. Disposal rejects outstanding calls; a ten-minute timer bounds operations whose worker never responds.

The UI also prevents simultaneous install/uninstall clicks. The server worker provides the stronger serialization guarantee.

## Iframe and address synchronization

The iframe is same-origin but internally scoped. `iframe-navigation.js` normalizes entered/boot paths, strips legacy query scopes, and adds the selected path scope. `App.vue` polls the iframe location every 500 ms because Frappe can change routes without notifying the shell.

On each successful inspection, the shell:

- removes scope and `_frappe_playground_bounce` from the displayed address;
- attempts one-time login-field prefilling;
- adds a Safari password-field font fix; and
- mirrors Frappe’s dark-mode marker onto the parent document.

The shell catches `frappe-playground-nested-shell` window messages. It rebuilds a scoped target and adds a timestamp bounce parameter, forcing Vue to update the iframe even when the nominal URL appears unchanged.

## Boot flags and failure cleanup

Boot flags run only after the backend is ready and before the iframe is shown. This allows app installation and authenticated setup API calls to use the worker without racing the initial Frappe page.

If a fresh instance fails during initialization, the root component disposes its worker and attempts to delete both its IndexedDB state and catalog entry. Existing restored instances are retained on failure so a transient dependency or update problem does not destroy saved data.

## Package boundary

The client imports constructors and validators from `packages/protocol`. It must not import Service Worker/server worker implementation. The inline recovery watchdog in `packages/client/index.html` is intentionally independent of the Vue bundle so it can recover when an obsolete Service Worker breaks normal module loading.
