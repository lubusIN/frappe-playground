import {
  addScopeToPath,
  queryWithoutLegacyScope,
  scopeFromUrl,
  stripScopeFromPath,
} from '../../protocol/src/scope-url.js'

export { scopeFromUrl }

export const VIRTUAL_SITE_HOST = 'site1'

export function isSocketIoPath(pathname) {
  return pathname.startsWith('/socket.io/')
}

const socketSessions = new Map()
let nextSocketSessionId = 1

function socketResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
  })
}

function enqueueSocketPacket(session, packet) {
  if (session.resolvePoll) {
    const resolve = session.resolvePoll
    session.resolvePoll = null
    clearTimeout(session.pollTimer)
    resolve(socketResponse(packet))
    return
  }
  session.packets.push(packet)
}

function socketNamespace(packet) {
  if (!packet.startsWith('40')) return null
  const namespace = packet.slice(2).split(',', 1)[0]
  return namespace.startsWith('/') ? namespace : ''
}

export async function handleSocketIoRequest(request, url) {
  const sid = url.searchParams.get('sid')

  if (!sid) {
    const newSid = `playground-${nextSocketSessionId++}`
    socketSessions.set(newSid, { packets: [], resolvePoll: null, pollTimer: 0 })
    return socketResponse(`0${JSON.stringify({
      sid: newSid,
      upgrades: [],
      pingInterval: 25000,
      pingTimeout: 20000,
    })}`)
  }

  const session = socketSessions.get(sid)
  if (!session) return socketResponse('Unknown Socket.IO session', 400)

  if (request.method === 'POST') {
    const payload = await request.text()
    for (const packet of payload.split('\x1e')) {
      const namespace = socketNamespace(packet)
      if (namespace !== null) {
        const prefix = namespace ? `40${namespace},` : '40'
        enqueueSocketPacket(session, `${prefix}${JSON.stringify({ sid })}`)
      } else if (packet.startsWith('41')) {
        socketSessions.delete(sid)
      }
    }
    return socketResponse('ok')
  }

  if (session.packets.length) {
    const response = socketResponse(session.packets.join('\x1e'))
    session.packets = []
    return response
  }
  if (session.resolvePoll) {
    // A browser may abort a long poll without the service worker observing the
    // cancellation before the replacement request arrives. Retire the stale
    // poll instead of returning an immediate 400 that makes Engine.IO reconnect
    // in a tight loop.
    const resolvePreviousPoll = session.resolvePoll
    session.resolvePoll = null
    clearTimeout(session.pollTimer)
    resolvePreviousPoll(socketResponse('2'))
  }

  return new Promise(resolve => {
    session.resolvePoll = resolve
    request.signal?.addEventListener('abort', () => {
      if (session.resolvePoll !== resolve) return
      session.resolvePoll = null
      clearTimeout(session.pollTimer)
      resolve(socketResponse('2'))
    }, { once: true })
    session.pollTimer = setTimeout(() => {
      if (session.resolvePoll !== resolve) return
      session.resolvePoll = null
      resolve(socketResponse('2'))
    }, 20000)
  })
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
  '/apps',
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
const DEVELOPMENT_PATH_PREFIXES = [
  '/@fs/',
  '/@id/',
  '/@vite/',
  '/node_modules/',
  '/src/',
]

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

export function isShellNavigation({ mode, pathname, explicitScope, clientFrameType }) {
  return mode === 'navigate'
    && pathname === '/'
    && !explicitScope
    && clientFrameType !== 'nested'
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
    if (scopedLocation.origin !== origin) {
      if (scopedLocation.hostname !== VIRTUAL_SITE_HOST) return
      const playgroundOrigin = new URL(origin)
      scopedLocation.protocol = playgroundOrigin.protocol
      scopedLocation.host = playgroundOrigin.host
    }
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
