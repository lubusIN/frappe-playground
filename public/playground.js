async function initPlayground() {
    const swRegistration = await navigator.serviceWorker.register('/sw.js');
    if (!navigator.serviceWorker.controller) {
        await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve));
    }
    const pyWorker = new Worker('worker.js', { type: 'module' });
    const channel = new MessageChannel();
    
    navigator.serviceWorker.controller.postMessage({ type: 'INIT_CHANNEL' }, [channel.port1]);
    pyWorker.postMessage({ type: 'INIT_CHANNEL' }, [channel.port2]);

    pyWorker.onmessage = (e) => {
        if (e.data.type === 'READY') {
            document.getElementById('loading-screen').style.display = 'none';
            const deskIframe = document.getElementById('frappe-desk');
            deskIframe.src = '/app';
            deskIframe.style.display = 'block';
        }
    };
}
if ('serviceWorker' in navigator) { window.addEventListener('load', initPlayground); }
