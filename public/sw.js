// ──────────────────────────────────────────────────────────────────────────────
// Frappe WASM Playground — Service Worker (Network Request Interceptor)
// ──────────────────────────────────────────────────────────────────────────────

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));

let workerPort = null;
let workerReady = false;

self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "INIT_CHANNEL") {
        workerPort = event.ports[0];
        workerReady = false;
        workerPort.onmessage = (msgEvent) => {
            if (msgEvent.data.type === "READY") {
                console.log("[SW] Received READY from worker");
                workerReady = true;
            }
        };
    }
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Only intercept same-origin requests
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith("/storage")) return;
    if (url.pathname.startsWith("/assets")) return;
    if (url.pathname.startsWith("/wheels")) return;
    if (url.pathname.startsWith("/pyodide")) return;
    if (url.pathname.startsWith("/python")) return;
    if (url.pathname === "/" || url.pathname === "/worker.js" || url.pathname === "/sw.js" || url.pathname === "/index.html" || url.pathname === "/config.js" || url.pathname === "/playground.js") return;
    
    // Mock Socket.io so the frontend connects successfully and stops spamming errors
    if (url.pathname.startsWith("/socket.io/")) {
        // If it's a POST request (sending data), just return OK
        if (event.request.method === "POST") {
            return event.respondWith(new Response("ok", { status: 200 }));
        }
        
        // If it's the initial handshake (sid is missing)
        if (!url.searchParams.has("sid")) {
            const handshake = `0{"sid":"mock-sid-123","upgrades":[],"pingInterval":25000,"pingTimeout":5000}`;
            return event.respondWith(new Response(handshake, { 
                status: 200, 
                headers: { "Content-Type": "text/plain" } 
            }));
        }
        
        // For subsequent GET polling, just hang the request forever like a real long-poll
        return event.respondWith(new Promise(() => {}));
    }

    // Everything else belongs to Frappe (Python WSGI)
    event.respondWith(callPythonHandler(event.request));
});

async function callPythonHandler(req) {
    if (!workerPort) {
        console.error("[SW] Worker port not initialized");
        return new Response("Service Worker not fully initialized", { status: 503 });
    }
    
    // Wait for the worker to be ready if it isn't yet
    if (!workerReady) {
        console.log("[SW] Waiting for Pyodide worker to be ready...");
        let attempts = 0;
        while (!workerReady && attempts < 900) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
        if (!workerReady) {
            console.error("[SW] Pyodide worker not ready after 90s. Aborting request:", req.path);
            return new Response("Pyodide backend timeout", { status: 504 });
        }
    }

    const payload = {
        method: req.method,
        path: new URL(req.url).pathname,
        query: new URL(req.url).search.slice(1),
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
        workerPort.postMessage(payload, [channel.port2]);
    });
}
