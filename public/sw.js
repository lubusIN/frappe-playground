// ──────────────────────────────────────────────────────────────────────────────
// Frappe Playground — Service Worker (Network Request Interceptor)
// ──────────────────────────────────────────────────────────────────────────────

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));

const instances = new Map();
const clientScopes = new Map();
const STATIC_PATHS = new Set(["/worker.js", "/config.js", "/playground.js", "/sw.js"]);
const STATIC_PATH_PREFIXES = ["/storage", "/assets", "/pyodide", "/python"];
const NODE_MODULES_ASSET_PREFIX = "/assets/frappe/node_modules/";
const DEPLOY_SAFE_NODE_MODULES_ASSET_PREFIX = "/assets/frappe/runtime_modules/";
const BACKEND_READY_TIMEOUT_MS = 90000;
const BACKEND_READY_POLL_MS = 100;

function parseScopedPath(pathname) {
    const match = pathname.match(/^\/scope:([^/]+)(\/.*)?$/);
    if (!match) return null;
    return {
        scope: decodeURIComponent(match[1]),
        path: match[2] || "/",
    };
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

function shouldRecoverScopeForNavigation(request, pathname) {
    if (request.mode !== "navigate") return false;
    if (isShellPath(pathname)) return false;
    if (isStaticPath(pathname)) return false;
    return true;
}

function isShellPath(pathname) {
    return pathname === "/" || pathname === "/index.html";
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
    if (event.data && event.data.type === "INIT_CHANNEL") {
        const scope = event.data.scope;
        const clientId = event.data.clientId;
        const instance = {
            port: event.ports[0],
            ready: false,
        };

        instances.set(scope, instance);
        if (clientId) clientScopes.set(clientId, scope);

        instance.port.onmessage = (msgEvent) => {
            if (msgEvent.data.type === "READY") {
                console.log("[SW] Received READY from worker:", scope);
                instance.ready = true;
            }
        };
    }
});

self.addEventListener("fetch", (event) => {
    if (event.request.url.startsWith(self.location.origin)) {
        const url = new URL(event.request.url);
        const scopedPath = parseScopedPath(url.pathname);
        const requestPath = scopedPath?.path || url.pathname;

        if (!scopedPath && !scopeFromUrl(url) && isStaticPath(requestPath)) {
            return;
        }

        event.respondWith(handleFetch(event));
    }
});

async function handleFetch(event) {
    const url = new URL(event.request.url);

    // Only intercept same-origin requests
    if (url.origin !== self.location.origin) return fetch(event.request);

    const scopedPath = parseScopedPath(url.pathname);
    const referrerUrl = event.request.referrer ? new URL(event.request.referrer) : null;
    const referrerPath = referrerUrl ? parseScopedPath(referrerUrl.pathname) : null;
    const clientUrl = event.clientId ? await getClientUrl(event.clientId) : null;
    const clientScope = clientUrl ? scopeFromUrl(clientUrl) || parseScopedPath(clientUrl.pathname)?.scope : null;
    const requestPath = scopedPath?.path || url.pathname;
    let scope = scopedPath?.scope
        || scopeFromUrl(url)
        || clientScopes.get(event.clientId)
        || clientScope
        || referrerPath?.scope
        || (referrerUrl && scopeFromUrl(referrerUrl))
        || (shouldRecoverScopeForNavigation(event.request, requestPath) && onlyActiveScope());

    if (instances.size === 0) {
        console.log("[SW] Instances empty! Broadcasting REQUEST_INIT_CHANNEL via BroadcastChannel...");
        const channel = new BroadcastChannel('sw-recovery');
        channel.postMessage({ type: 'REQUEST_INIT_CHANNEL' });
        
        // Wait up to 1s for main page to respond with INIT_CHANNEL
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 50));
            if (instances.size > 0) {
                console.log("[SW] Recovered instance!");
                if (!scope) scope = onlyActiveScope();
                break;
            }
        }
        if (instances.size === 0) console.log("[SW] Failed to recover instances after 1s!");
    }

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
        const requestOptions = {
            method: event.request.method,
            headers: event.request.headers,
            credentials: event.request.credentials
        };

        if (!scopedPath && !scopeFromUrl(url) && strippedUrl.href === event.request.url) {
            return fetch(event.request);
        }

        return fetch(strippedUrl.href, requestOptions);
    }
    

    if (!scope) return fetch(event.request);

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
    
    if (!await waitForInstanceReady(instance, scope)) {
        console.error("[SW] Pyodide worker not ready after 90s. Aborting request:", requestPath);
        return new Response("Pyodide backend timeout", { status: 504 });
    }

    const payload = {
        method: req.method,
        path: requestPath,
        query,
        headers: Object.fromEntries(req.headers.entries()),
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
        payload.body = await req.text();
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
        if (isShellPath(scopedLocation.pathname)) return;
        if (isStaticPath(scopedLocation.pathname)) return;

        scopedLocation.searchParams.set("__scope", scope);
        headers.set("Location", `${scopedLocation.pathname}${scopedLocation.search}${scopedLocation.hash}`);
    } catch (_) {
        // Leave malformed/non-URL Location headers untouched.
    }
}

async function waitForInstanceReady(instance, scope) {
    if (instance.ready) return true;

    console.log("[SW] Waiting for Pyodide worker to be ready:", scope);
    const deadline = Date.now() + BACKEND_READY_TIMEOUT_MS;
    while (!instance.ready && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, BACKEND_READY_POLL_MS));
    }

    return instance.ready;
}
