import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const authoredStaticDir = path.join(projectRoot, 'public')
const serviceWorkerSourceDir = path.join(projectRoot, 'service-worker/src')
const serverSourceDir = path.join(projectRoot, 'playground-server/src')
const pythonSourceDir = path.join(projectRoot, 'runtime/python')
const runtimeArtifactsDir = path.join(projectRoot, 'artifacts/runtime')
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Access-Control-Allow-Origin': '*',
}

const exactDevFiles = new Map([
  ['/sw.js', path.join(serviceWorkerSourceDir, 'sw.js')],
  ['/worker.js', path.join(serverSourceDir, 'worker.js')],
  ['/config.js', path.join(serverSourceDir, 'config.js')],
  ['/_headers', path.join(authoredStaticDir, '_headers')],
  ['/_redirects', path.join(authoredStaticDir, '_redirects')],
  ['/favicon.ico', path.join(authoredStaticDir, 'favicon.ico')],
])

const prefixedDevFiles = [
  ['/python/', pythonSourceDir],
  ['/storage/', runtimeArtifactsDir],
  ['/assets/', path.join(runtimeArtifactsDir, 'assets')],
]

function resolveDevFile(pathname) {
  const exactFile = exactDevFiles.get(pathname)
  if (exactFile) return exactFile

  for (const [prefix, directory] of prefixedDevFiles) {
    if (!pathname.startsWith(prefix)) continue

    const relativePath = decodeURIComponent(pathname.slice(prefix.length))
    const filePath = path.normalize(path.join(directory, relativePath))
    if (filePath.startsWith(directory + path.sep)) return filePath
  }

  return null
}

function runtimeFileMiddleware(req, res, next) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname

  if (pathname === '/' || pathname === '/index.html') {
    next()
    return
  }

  const filePath = resolveDevFile(pathname)
  if (!filePath) {
    next()
    return
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      next()
      return
    }

    for (const [header, value] of Object.entries(isolationHeaders)) {
      res.setHeader(header, value)
    }
    res.setHeader('Content-Type', contentTypeFor(filePath))
    fs.createReadStream(filePath).pipe(res)
  })
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath)

  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.py': 'text/x-python; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.whl': 'application/octet-stream',
    '.woff2': 'font/woff2',
    '.gz': 'application/gzip',
    '.db': 'application/octet-stream',
  }[extension] || 'application/octet-stream'
}

export default defineConfig({
  root: 'src',
  base: '/',
  publicDir: false,
  plugins: [
    vue(),
    Icons({ compiler: 'vue3' }),
    {
      name: 'frappe-playground-frontend',
      configureServer(server) {
        server.middlewares.use(runtimeFileMiddleware)
      },
    },
  ],
  build: {
    outDir: '../dist',
    assetsDir: 'frontend',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (warning.code === 'INVALID_ANNOTATION') return
        defaultHandler(warning)
      },
    },
  },
  resolve: {
    alias: {
      'frappe-ui/components': path.join(
        projectRoot,
        'node_modules/frappe-ui/src/components',
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    headers: isolationHeaders,
  },
  preview: {
    port: 8000,
    strictPort: false,
    headers: isolationHeaders,
  },
  optimizeDeps: {
    // Frappe UI source imports feather-icons as a CJS default. Pre-bundle it
    // so Vite serves an ESM interop wrapper instead of the raw UMD file.
    include: [
      'feather-icons', 
      'debug', 
      'highlight.js', 
      'highlight.js/lib/core', 
      'interactjs'
    ],
  },
})
