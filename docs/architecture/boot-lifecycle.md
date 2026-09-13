# Boot lifecycle

Boot is staged so the UI can report useful progress and recover worker channels after reloads.

## 1. Select an instance

`PlaygroundController.start()` reads the active localStorage ID, selects the most recently opened instance, adopts a legacy pre-catalog instance, or creates a fresh one. A newly created instance passes `fresh=true` to its server worker.

## 2. Activate the Service Worker

The shell registers `/sw.js` as a module worker with `updateViaCache: 'none'`. It distinguishes initial control from an upgrade, waits for the expected build-versioned worker, and reloads when a later controller replaces an active one.

The client can communicate with `registration.active` even when a hard reload temporarily leaves the page uncontrolled. A 15-second registration timeout and 30-second upgrade timeout turn stuck lifecycle states into visible errors.

## 3. Start the server worker

The shell creates `/worker.js?scope=<id>&fresh=<boolean>` as an ES module worker. The build ID is also attached to runtime entry URLs so browser caches do not combine releases.

## 4. Transfer the channel

A fresh `MessageChannel` is created. The shell sends the same versioned `channel:init` message to both workers and transfers one port to each. The server worker begins boot only after its first channel-init message.

## 5. Boot Python and Frappe

The server worker performs these stages:

1. load Pyodide and install the configured Python packages;
2. unpack the prepared Frappe filesystem and assets;
3. restore the scoped IndexedDB state, or copy the seed `site1.db` for a fresh site;
4. restore installed optional apps;
5. write `site_config.json`, `currentsite.txt`, the asset manifest, and app list;
6. load browser compatibility shims and MariaDB-to-SQLite polyfills;
7. configure the Python WSGI bridge; and
8. publish `runtime:ready` with the installed app IDs.

Progress messages use the stages `service-worker`, `python`, `runtime`, `database`, and `frappe`, with `active` or `done` status.

## 6. Load the Frappe iframe

After readiness, the shell processes URL boot flags, optionally installs apps, logs in, runs Setup Wizard completion, and computes the initial route. The iframe receives a scoped internal URL while navigation helpers keep the human-facing history unscoped.

## Recovery

The Service Worker can be restarted independently of dedicated workers. When it lacks a channel for a known client, it broadcasts a versioned recovery request on `sw-recovery`. Visible pages also recheck worker updates and recreate their channels. A repeated `runtime:ready` from an already ready worker is treated as wake-up, not a second boot.
