export const SCOPE_QUERY_PARAM = '__scope'

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

const STATIC_PATHS = new Set(['/worker.js', '/config.js', '/sw.js'])
const STATIC_PATH_PREFIXES = [
  '/storage',
  '/assets',
  '/pyodide',
  '/generated',
  '/server',
  '/protocol',
  '/service-worker',
]
const DEVELOPMENT_PATH_PREFIXES = ['/@vite/', '/@fs/', '/src/', '/node_modules/']

export function scopeFromUrl(url) {
  return url.searchParams.get(SCOPE_QUERY_PARAM)
}

export function queryWithoutScope(url) {
  const params = new URLSearchParams(url.search)
  params.delete(SCOPE_QUERY_PARAM)
  return params.toString()
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
  url.pathname = remapStaticPath(url.pathname)
  url.searchParams.delete(SCOPE_QUERY_PARAM)
  return url
}

export function scopeRedirectLocation(headers, scope, origin) {
  const location = headers.get('Location')
  if (!location || !scope) return

  try {
    const scopedLocation = new URL(location, origin)
    if (scopedLocation.origin !== origin) return
    if (scopedLocation.pathname === '/' || isStaticPath(scopedLocation.pathname)) return

    scopedLocation.searchParams.set(SCOPE_QUERY_PARAM, scope)
    headers.set(
      'Location',
      `${scopedLocation.pathname}${scopedLocation.search}${scopedLocation.hash}`,
    )
  } catch (_) {
    // Leave malformed and non-URL Location headers untouched.
  }
}
