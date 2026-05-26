const express = require('express');
const path = require('path');
const app = express();
const PORT = 8000;

// CRITICAL MIDDLEWARE: Inject COOP and COEP isolation headers
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

// Serve the web assets (index.html, worker.js, sw.js, UI-App.js)
app.use(express.static(path.join(__dirname, 'public')));

// Serve Frappe frontend assets
app.use('/assets', express.static(path.join(__dirname, 'storage', 'assets')));

// Emulate Cloudflare R2 storage bucket endpoint
app.use('/storage', express.static(path.join(__dirname, 'storage')));

// Handle direct route navigation fallbacks for the inner iframe paths
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Frappe WASM Playground live at http://localhost:${PORT}`);
});
