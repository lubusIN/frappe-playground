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

// Serve the web assets (index.html, worker.js, sw.js, playground.js)
app.use(express.static(path.join(__dirname, 'public')));

// Serve prepared runtime files from the same layout Cloudflare Pages publishes.
app.use('/storage', express.static(path.join(__dirname, 'public', 'storage')));
app.use('/storage', (req, res) => res.sendStatus(404));

// Handle direct route navigation fallbacks for the inner iframe paths
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Frappe Playground live at http://localhost:${PORT}`);
});
