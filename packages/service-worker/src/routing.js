import {
  addScopeToPath,
  queryWithoutLegacyScope,
  scopeFromUrl,
  stripScopeFromPath,
} from '../../protocol/src/scope-url.js'

export { scopeFromUrl }

export function isSocketIoPath(pathname) {
  return pathname.startsWith('/socket.io/')
}

export function handleSocketIoRequest(request, url) {
  if (request.method === 'POST') return new Response('ok', { status: 200 })

  if (!url.searchParams.has('sid')) {
    const handshake = '0{"sid":"mock-sid-123","upgrades":[],"pingInterval":25000,"pingTimeout":5000}'
    return new Response(handshake, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return new Promise(() => {})
}
export const NODE_MODULES_ASSET_PREFIX = '/assets/frappe/node_modules/'
export const DEPLOY_SAFE_NODE_MODULES_ASSET_PREFIX = '/assets/frappe/runtime_modules/'

const STATIC_PATHS = new Set([
  '/config.js',
  '/favicon.ico',
  '/index.html',
  '/sw.js',
  '/worker.js',
])
const STATIC_PATH_PREFIXES = [
  '/assets',
  '/frontend',
  '/generated',
  '/protocol',
  '/pyodide',
  '/runtime-config',
  '/service-worker',
  '/server',
  '/storage',
]
const DEVELOPMENT_PATH_PREFIXES = ['/@vite/', '/@fs/', '/src/', '/node_modules/']

export function isShellStaticPath(pathname) {
  return pathname === '/favicon.ico'
    || pathname === '/index.html'
    || pathname.startsWith('/frontend/')
}

export function queryWithoutScope(url) {
  return queryWithoutLegacyScope(url)
}

export function isStaticPath(pathname) {
  if (STATIC_PATHS.has(pathname)) return true
  return STATIC_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

export function isDevelopmentPath(pathname) {
  return DEVELOPMENT_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

export function remapStaticPath(pathname) {
  if (pathname.startsWith(NODE_MODULES_ASSET_PREFIX)) {
    return pathname.replace(
      NODE_MODULES_ASSET_PREFIX,
      DEPLOY_SAFE_NODE_MODULES_ASSET_PREFIX,
    )
  }
  return pathname
}

export function staticRequestUrl(requestUrl) {
  const url = new URL(requestUrl)
  url.pathname = remapStaticPath(stripScopeFromPath(url.pathname))
  url.searchParams.delete('__scope')
  return url
}

export function scopeRedirectLocation(headers, scope, origin) {
  const location = headers.get('Location')
  if (!location || !scope) return

  try {
    const scopedLocation = new URL(location, origin)
    if (scopedLocation.origin !== origin) return
    if (isStaticPath(stripScopeFromPath(scopedLocation.pathname))) return

    scopedLocation.pathname = addScopeToPath(scopedLocation.pathname, scope)
    scopedLocation.searchParams.delete('__scope')
    headers.set(
      'Location',
      `${scopedLocation.pathname}${scopedLocation.search}${scopedLocation.hash}`,
    )
  } catch (_) {
    // Leave malformed and non-URL Location headers untouched.
  }
}
