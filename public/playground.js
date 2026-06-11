// ──────────────────────────────────────────────────────────────────────────────
// Frappe Playground — Initialization Script
// ──────────────────────────────────────────────────────────────────────────────

async function initPlayground() {
    const sessionKey = "frappe_playground_instance_id";
    let instanceId = sessionStorage.getItem(sessionKey);
    const freshSession = !instanceId;

    if (!instanceId) {
        instanceId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        sessionStorage.setItem(sessionKey, instanceId);
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
    function setupChannel(clientId = null) {
        const channel = new MessageChannel();
        navigator.serviceWorker.controller.postMessage({ 
            type: 'INIT_CHANNEL', 
            scope: instanceId,
            clientId: clientId 
        }, [channel.port1]);
        pyWorker.postMessage({ type: 'INIT_CHANNEL', freshSession, scope: instanceId }, [channel.port2]);
    }
    setupChannel();

    window.swRecoveryChannel = new BroadcastChannel('sw-recovery');
    window.swRecoveryChannel.onmessage = (event) => {
        console.log("[Playground] Received BroadcastChannel message:", event.data);
        if (event.data && event.data.type === 'REQUEST_INIT_CHANNEL') {
            console.log("[Playground] SW requested channel re-init (via BroadcastChannel). Re-establishing...");
            setupChannel();
        }
    };

    // 4. Listen for the Web Worker to finish its complex python bootstrap sequence
    pyWorker.onmessage = (e) => {
        if (e.data.type === 'READY') {
            document.getElementById('loading-screen').style.display = 'none';
            const deskIframe = document.getElementById('frappe-desk');
            deskIframe.src = `/?__scope=${encodeURIComponent(instanceId)}`;
            deskIframe.style.display = 'block';
        }
    };
}

if ('serviceWorker' in navigator) { 
    window.addEventListener('load', initPlayground); 
}
