---
outline: false
pageClass: playground-home
---

<div class="playground-hero">
  <p class="playground-eyebrow">Frappe in the browser</p>
  <h1>A complete Frappe site in your browser</h1>
  <p class="playground-tagline">Learn how to use it, host it, customize it, and understand the WebAssembly runtime underneath.</p>
  <div class="playground-actions">
    <a class="playground-action playground-action-primary" href="./guide/getting-started">Start using it</a>
    <a class="playground-action" href="./architecture/">Explore the architecture</a>
  </div>
</div>

<div class="playground-features">
  <section><h2>No backend to provision</h2><p>Frappe, SQLite, and the WSGI request loop execute locally in a Pyodide Web Worker.</p></section>
  <section><h2>Isolated playgrounds</h2><p>Create multiple named sites. Each keeps its database, cookies, uploaded files, and installed-app list in its own IndexedDB database.</p></section>
  <section><h2>Static hosting</h2><p>The production output is a static directory. Serve it over HTTPS with the required cross-origin isolation headers.</p></section>
  <section><h2>Reproducible demos</h2><p>Use URL parameters to create a named playground, install supported apps, complete onboarding, sign in, and open a specific route.</p></section>
</div>

## What is Frappe Playground?

Frappe Playground runs a prepared Frappe Framework site entirely inside a browser tab. The page shell is a Vue application, Python executes through Pyodide, Frappe uses SQLite, and a Service Worker makes the in-browser WSGI application look like a normal same-origin website.

It is designed for experiments, demos, learning, and compatibility work. It is not a hosted Bench, and it does not provide a Redis service, background workers, Socket.IO realtime events, remote persistence, or server-side backups.

<div class="architecture-flow">
  <div>Vue shell</div>
  <div>Service Worker</div>
  <div>MessageChannel</div>
  <div>Pyodide worker</div>
  <div>Frappe WSGI</div>
</div>

## Choose a path

- [Use the playground](/guide/getting-started) to create sites, install supported apps, and automate a demo with URL parameters.
- [Host your own copy](/hosting/) to build the runtime and publish it on Cloudflare Pages or another capable static host.
- [Customize it](/hosting/customize) to change branding, runtime configuration, Frappe, or the curated app catalog.
- [Understand the internals](/architecture/) to follow boot, routing, persistence, and cross-worker messages end to end.
- [Contribute](/development/) to work locally and run the repository’s verification suites.

::: warning Experimental
Important data should live elsewhere. Browser site data is the only persistence layer, and clearing it deletes playground instances.
:::
