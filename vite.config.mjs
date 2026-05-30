import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(projectRoot, 'public')
const frontendAssetsDir = path.join(publicDir, 'frontend')
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Access-Control-Allow-Origin': '*',
}

function publicFileMiddleware(req, res, next) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname

  if (pathname === '/' || pathname === '/index.html') {
    next()
    return
  }

  const filePath = path.normalize(path.join(publicDir, decodeURIComponent(pathname)))

  if (!filePath.startsWith(publicDir + path.sep)) {
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
  plugins: [
    vue(),
    {
      name: 'frappe-playground-frontend',
      buildStart() {
        fs.rmSync(frontendAssetsDir, { recursive: true, force: true })
      },
      configureServer(server) {
        server.middlewares.use(publicFileMiddleware)
      },
    },
  ],
  build: {
    outDir: '../public',
    assetsDir: 'frontend',
    emptyOutDir: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      'frappe-ui/components': path.join(
        projectRoot,
        'node_modules/frappe-ui/src/components',
      ),
      '~icons/lucide/x': path.join(projectRoot, 'src/components/LucideXIcon.vue'),
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
})
