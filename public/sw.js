// ──────────────────────────────────────────────────────────────────────────────
// Frappe Playground — Service Worker (Network Request Interceptor)
// ──────────────────────────────────────────────────────────────────────────────

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));

const instances = new Map();
const clientScopes = new Map();
const STATIC_PATH_PREFIXES = ["/storage", "/assets", "/wheels", "/pyodide", "/python"];
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

function queryWithoutScope(url) {
    const params = new URLSearchParams(url.search);
    params.delete("__scope");
    return params.toString();
}

function isStaticPath(pathname) {
    return STATIC_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "INIT_CHANNEL") {
        const scope = event.data.scope;
        const instance = {
            port: event.ports[0],
            ready: false,
        };

        instances.set(scope, instance);

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
    const scope = scopedPath?.scope || scopeFromUrl(url) || clientScopes.get(event.clientId) || clientScope || referrerPath?.scope || (referrerUrl && scopeFromUrl(referrerUrl));
    const requestPath = scopedPath?.path || url.pathname;

    if (scope) {
        if (event.clientId) {
            clientScopes.set(event.clientId, scope);
        }

        if (event.resultingClientId) {
            clientScopes.set(event.resultingClientId, scope);
        }
    }

    if (isStaticPath(requestPath)) {
        if (!scopedPath && !scopeFromUrl(url)) return fetch(event.request);

        const strippedUrl = new URL(event.request.url);
        strippedUrl.pathname = requestPath;
        strippedUrl.searchParams.delete("__scope");
        const requestOptions = {
            method: event.request.method,
            headers: event.request.headers,
            credentials: event.request.credentials
        };
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
            // Pyodide responses might be plain text or HTML; let browser guess if not set
            resolve(new Response(body, { status, headers: resHeaders }));
        };
        instance.port.postMessage(payload, [channel.port2]);
    });
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
