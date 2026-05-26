// ──────────────────────────────────────────────────────────────────────────────
// Frappe WASM Playground — Initialization Script
// ──────────────────────────────────────────────────────────────────────────────

async function initPlayground() {
    // Use a session cookie to determine if this is the first tab opened in this browser session.
    // Session cookies are cleared when the browser is fully closed, which perfectly matches
    // the requirement to "persist sqlite for tabs session and keep it alive until use close browser".
    const hasSessionCookie = document.cookie.includes("frappe_session_active=1");
    let freshSession = !hasSessionCookie;
    
    if (freshSession) {
        document.cookie = "frappe_session_active=1; path=/";
    }

    // 1. Register the Service Worker to intercept all network requests for routing to Python WSGI
    const swRegistration = await navigator.serviceWorker.register('/sw.js');
    if (!navigator.serviceWorker.controller) {
        // Wait until the service worker claims the client before proceeding
        await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve));
    }
    
    // 2. Spawn the Web Worker that runs the Pyodide Python Sandbox
    const pyWorker = new Worker('worker.js', { type: 'module' });
    
    // 3. Establish a direct MessageChannel for high-performance communication
    const channel = new MessageChannel();
    navigator.serviceWorker.controller.postMessage({ type: 'INIT_CHANNEL' }, [channel.port1]);
    
    // Pass the freshSession flag to the worker.
    pyWorker.postMessage({ type: 'INIT_CHANNEL', freshSession }, [channel.port2]);

    // 4. Listen for the Web Worker to finish its complex python bootstrap sequence
    pyWorker.onmessage = (e) => {
        if (e.data.type === 'READY') {
            document.getElementById('loading-screen').style.display = 'none';
            const deskIframe = document.getElementById('frappe-desk');
            deskIframe.src = '/app';
            deskIframe.style.display = 'block';
        }
    };
}

if ('serviceWorker' in navigator) { 
    window.addEventListener('load', initPlayground); 
}
