# Getting started

Frappe Playground starts a local Frappe site in your browser. There is no account to create and no remote server to configure.

## Browser requirements

Use a current desktop or mobile browser with WebAssembly, ES module workers, Service Workers, IndexedDB, and cross-origin isolation support. The tested minimums documented by the project are Chrome/Edge 80, Safari/iOS 15, and Firefox 114. A newer release is strongly recommended because the runtime is large and worker behavior has improved over time.

The page must be served from `localhost` or over HTTPS. Opening the generated HTML directly from disk will not work.

## First boot

1. Open the playground URL.
2. Wait while the Service Worker starts, Pyodide loads, the Frappe filesystem is installed, and the site database is seeded or restored.
3. Sign in with the demo credentials:

```text
Username: Administrator
Password: admin
```

On a new instance, Frappe may show its Setup Wizard. Complete it normally, or use the [`onboarding=0` boot flag](./boot-flags) for an automated disposable demo.

![The first-run notice over Frappe's prefilled sign-in screen](/images/first-run.png)

*The first-run notice repeats the demo credentials. Select **I understand** to dismiss it; the sign-in form behind it is already filled in.*

::: danger Demo credentials
The default password and disabled CSRF checks are intentional browser-playground defaults. Do not treat this runtime as a security boundary or reuse this configuration for an internet-facing Frappe server.
:::

## The dock

The shell’s dock provides access to the playground iframe, instance manager, and optional-app manager. A playground instance is a local browser site, not a remote deployment. See [Playground interface](./interface) for every control and its navigation behavior.

The initial boot can take noticeably longer than later visits. Browser caching avoids refetching unchanged runtime assets, while IndexedDB restores your site state.

## What survives a reload?

The active instance’s SQLite database, cookie jar, uploaded public/private files, and installed-app list are checkpointed to IndexedDB. The shell’s instance names and active selection live in `localStorage`.

See [Instances and storage](./instances) for the exact lifecycle and deletion behavior.
