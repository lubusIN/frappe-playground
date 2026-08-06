// ──────────────────────────────────────────────────────────────────────────────
// Frappe Playground — Service Worker (Network Request Interceptor)
// ──────────────────────────────────────────────────────────────────────────────

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));



const instances = new Map();
const clientScopes = new Map();
const STATIC_PATHS = new Set(["/worker.js", "/config.js", "/sw.js"]);
const STATIC_PATH_PREFIXES = ["/storage", "/assets", "/pyodide", "/python"];
const NODE_MODULES_ASSET_PREFIX = "/assets/frappe/node_modules/";
const DEPLOY_SAFE_NODE_MODULES_ASSET_PREFIX = "/assets/frappe/runtime_modules/";
const BACKEND_READY_TIMEOUT_MS = 90000;
const BACKEND_READY_POLL_MS = 100;

function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
}

let currentCacheName = null;
let initCachePromise = null;

async function getCacheName() {
    if (currentCacheName) return currentCacheName;
    if (!initCachePromise) {
        initCachePromise = (async () => {
            try {
                const res = await fetch(`/assets/assets.json?t=${Date.now()}`);
                const text = await res.text();
                const hash = hashString(text);
                currentCacheName = `frappe-assets-${hash}`;
                
                // Cleanup old caches
                const keys = await caches.keys();
                for (const key of keys) {
                    if (key.startsWith('frappe-assets-') && key !== currentCacheName) {
                        console.log(`[SW] Deleting old cache: ${key}`);
                        await caches.delete(key);
                    }
                }
            } catch (err) {
                console.warn("[SW] Failed to fetch assets.json for cache naming, falling back.", err);
                currentCacheName = 'frappe-assets-fallback';
            }
        })();
    }
    await initCachePromise;
    return currentCacheName;
}

async function handleStaticCache(request, strippedUrl = null) {
    const cacheName = await getCacheName();
    const cache = await caches.open(cacheName);
    const urlToCache = strippedUrl || request.url;
    
    let response = await cache.match(urlToCache);
    if (response) {
        return response;
    }
    
    const requestOptions = {
        method: request.method,
        headers: request.headers,
        credentials: request.credentials
    };
    
    response = strippedUrl ? await fetch(strippedUrl, requestOptions) : await fetch(request);
    
    if (response.ok || response.type === 'opaque') {
        cache.put(urlToCache, response.clone());
    }
    
    return response;
}




function getInstance(scope) {
    if (!scope) return null;
    return instances.get(scope) || null;
}

function scopeFromUrl(url) {
    return url.searchParams.get("__scope");
}

function onlyActiveScope() {
    return instances.size === 1 ? instances.keys().next().value : null;
}

function queryWithoutScope(url) {
    const params = new URLSearchParams(url.search);
    params.delete("__scope");
    return params.toString();
}

function isStaticPath(pathname) {
    if (STATIC_PATHS.has(pathname)) return true;
    return STATIC_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

function remapStaticPath(pathname) {
    if (pathname.startsWith(NODE_MODULES_ASSET_PREFIX)) {
        return pathname.replace(NODE_MODULES_ASSET_PREFIX, DEPLOY_SAFE_NODE_MODULES_ASSET_PREFIX);
    }

    return pathname;
}

self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "CLEAR_OTHER_INSTANCES") {
        const keepScope = event.data.scope;
        for (const scope of instances.keys()) {
            if (scope !== keepScope) {
                instances.delete(scope);
                console.log(`[SW] Cleared stale instance: ${scope}`);
            }
        }
        return;
    }
    
    if (event.data && event.data.type === "CLAIM_CLIENTS") {
        self.clients.claim();
        return;
    }

    if (event.data && event.data.type === "INIT_CHANNEL") {
        const scope = event.data.scope;
        const clientId = event.source ? event.source.id : event.data.clientId;
        const instance = {
            port: event.ports[0],
            ready: false,
            clientId: clientId
        };

        instances.set(scope, instance);

        if (clientId) clientScopes.set(clientId, scope);

        instance.port.onmessage = (msgEvent) => {
            if (msgEvent.data.type === "READY") {
                console.log(`[SW] Received READY from worker: ${scope}`);
                instance.ready = true;
            }
        };
    }
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Cache Pyodide CDN assets
    if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/pyodide/')) {
        event.respondWith(handleStaticCache(event.request));
        return;
    }

    if (event.request.url.startsWith(self.location.origin)) {
        if (!scopeFromUrl(url) && isStaticPath(url.pathname)) {
            // We must still intercept if it's a node_modules path that needs remapping
            if (!url.pathname.startsWith(NODE_MODULES_ASSET_PREFIX)) {
                event.respondWith(handleStaticCache(event.request));
                return;
            }
        }

        event.respondWith(handleFetch(event));
    }
});

async function handleFetch(event) {
    const url = new URL(event.request.url);

    // Only intercept same-origin requests
    if (url.origin !== self.location.origin) return fetch(event.request);
    
    // Fast-path for Vite and Vue development assets to prevent them from triggering recovery
    const requestPath = url.pathname;
    if (requestPath.startsWith("/@vite/") || requestPath.startsWith("/@fs/") || requestPath.startsWith("/src/") || requestPath.startsWith("/node_modules/")) {
        return fetch(event.request);
    }

    const isShellNavigation = event.request.mode === 'navigate' && url.pathname === '/';

    // Prevent top-level navigations to the shell from inheriting a scope via referrer
    if (isShellNavigation && !scopeFromUrl(url)) {
        return fetch(event.request);
    }

    const clientUrl = event.clientId ? await getClientUrl(event.clientId) : null;
    const clientScope = clientUrl ? scopeFromUrl(clientUrl) : null;
    
    let scope = scopeFromUrl(url)
        || clientScopes.get(event.clientId)
        || clientScope
        || (event.request.mode === 'navigate' && !isShellNavigation && !isStaticPath(requestPath) && onlyActiveScope());

    if (scope) {
        if (event.clientId) {
            clientScopes.set(event.clientId, scope);
        }

        if (event.resultingClientId) {
            clientScopes.set(event.resultingClientId, scope);
        }
    }

    if (isStaticPath(requestPath)) {
        const strippedUrl = new URL(event.request.url);
        strippedUrl.pathname = remapStaticPath(requestPath);
        strippedUrl.searchParams.delete("__scope");
        
        if (!scopeFromUrl(url) && strippedUrl.href === event.request.url) {
            return handleStaticCache(event.request);
        }

        return handleStaticCache(event.request, strippedUrl.href);
    }
    
    if (!scope) {
        console.log(`[SW] Fetching natively: ${event.request.url}`);
        return fetch(event.request);
    }

    if (instances.size === 0) {
        console.log("[SW] Instances empty! Broadcasting REQUEST_INIT_CHANNEL via BroadcastChannel...");
        const channel = new BroadcastChannel('sw-recovery');
        channel.postMessage({ type: 'REQUEST_INIT_CHANNEL' });
        
        // Wait gracefully until instance is recovered (no timeout, so inactive tabs don't crash requests)
        while (instances.size === 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        console.log("[SW] Recovered instance!");
        if (!scope) scope = onlyActiveScope();
    }


    console.log(`[SW] Waiting for instance ready for scope: ${scope}`);
    const isReady = await waitForInstanceReady(scope);
    const instance = getInstance(scope);
    // Mock Socket.io so the frontend connects successfully and stops spamming errors.
    if (requestPath.startsWith("/socket.io/")) {
        if (event.request.method === "POST") {
            return new Response("ok", { status: 200 });
        }

        if (!url.searchParams.has("sid")) {
            const handshake = `0{"sid":"mock-sid-123","upgrades":[],"pingInterval":25000,"pingTimeout":5000}`;
            return new Response(handshake, {
                status: 200,
                headers: { "Content-Type": "text/plain" }
            });
        }

        return new Promise(() => {});
    }

    // Everything else belongs to Frappe (Python WSGI)
    return callPythonHandler(event.request, scope, requestPath, queryWithoutScope(url));
}

async function getClientUrl(clientId) {
    try {
        const client = await clients.get(clientId);
        return client ? new URL(client.url) : null;
    } catch (_) {
        return null;
    }
}

async function callPythonHandler(req, scope, requestPath, query) {
    const instance = getInstance(scope);

    if (!instance) {
        console.error("[SW] Worker port not initialized for scope:", scope);
        return new Response("Service Worker not fully initialized for this tab", { status: 503 });
    }

    const payload = {
        method: req.method,
        path: requestPath,
        query,
        headers: Object.fromEntries(req.headers.entries()),
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
        payload.body = await req.arrayBuffer();
    }

    return new Promise((resolve) => {
        const channel = new MessageChannel();

        channel.port1.onmessage = (msgEvent) => {
            const { status, headers, body } = msgEvent.data;
            const resHeaders = new Headers(headers);

            // Isolation headers required for iframe navigation under parent's COEP: require-corp
            resHeaders.set("Cross-Origin-Resource-Policy", "same-origin");
            resHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
            resHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
            scopeRedirectLocation(resHeaders, scope);
            // Pyodide responses might be plain text or HTML; let browser guess if not set
            resolve(new Response(body, { status, headers: resHeaders }));
        };
        instance.port.postMessage(payload, [channel.port2]);
    });
}

function scopeRedirectLocation(headers, scope) {
    const location = headers.get("Location");
    if (!location || !scope) return;

    try {
        const scopedLocation = new URL(location, self.location.origin);
        if (scopedLocation.origin !== self.location.origin) return;
        if (scopedLocation.pathname === '/') return;
        if (isStaticPath(scopedLocation.pathname)) return;

        scopedLocation.searchParams.set("__scope", scope);
        headers.set("Location", `${scopedLocation.pathname}${scopedLocation.search}${scopedLocation.hash}`);
    } catch (_) {
        // Leave malformed/non-URL Location headers untouched.
    }
}

async function waitForInstanceReady(scope) {
    let instance = getInstance(scope);
    if (instance && instance.ready) return true;

    console.log(`[SW] Waiting for Pyodide worker to be ready: ${scope}`);
    const deadline = Date.now() + BACKEND_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        instance = getInstance(scope);
        if (instance && instance.ready) return true;
        await new Promise(resolve => setTimeout(resolve, BACKEND_READY_POLL_MS));
    }

    return false;
}
