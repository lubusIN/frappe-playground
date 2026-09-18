# Deploy to another static host

Any host can serve the built `dist/` tree if it reproduces the project’s HTTP contract. Upload the directory without changing its internal paths.

## Host checklist

- Serve over HTTPS.
- Apply the four [cross-origin isolation headers](./#required-headers) to HTML, JavaScript, WebAssembly, assets, and generated backend responses.
- Serve `.js` as JavaScript, `.wasm` as `application/wasm`, `.json` as JSON, `.zip` as ZIP, `.whl` as a binary stream, and `.gz` as gzip data.
- Do not rewrite real files under `/docs`, `/assets`, `/storage`, `/apps`, `/frontend`, `/protocol`, `/server`, `/service-worker`, `/runtime-config`, or `/generated` to the shell.
- Rewrite unknown playground navigation routes to `/index.html`.
- Redirect `/docs` to `/docs/` or serve the same documentation index at both locations.
- Avoid long-lived caching for `/sw.js`, `/worker.js`, and the authored runtime JavaScript modules listed in `static/_headers`.
- Allow a root-scoped module Service Worker.

## Why origin-root hosting matters

The server worker and Frappe output use stable root URLs such as `/storage`, `/assets`, and `/protocol`. Frappe itself also emits root-relative routes. Changing only Vite’s base path is therefore insufficient to mount the application at `/playground/`.

Use a dedicated domain or let the playground own `/` on a shared domain. This documentation is already designed for `/docs/`.

## Test the headers

In the deployed playground console:

```js
window.crossOriginIsolated
```

It must evaluate to `true`. Also inspect a runtime module and WebAssembly response in developer tools to confirm its MIME type and cross-origin resource policy.

## CDN cache changes

The Service Worker derives its Frappe asset cache name from the published `assets.json` and app catalog. Old matching caches are removed when those inputs change. This does not replace HTTP cache control for worker entry modules; a stale entry worker can import paths whose contents belong to a different release.
