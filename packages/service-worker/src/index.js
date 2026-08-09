// Frappe Playground — Service Worker entry point
import {
  ProtocolMessageType,
  createAssociateClientMessage,
  createRecoveryRequestMessage,
  isProtocolMessage,
} from '/protocol/messages.js'
import {
  createBackendRequest,
  readBackendResponse,
} from '/protocol/request.js'
import { createBackendProxy } from '/service-worker/backend-proxy.js'
import { RuntimeAssetCache } from '/service-worker/cache.js'
import { InstanceRegistry } from '/service-worker/instance-registry.js'
import {
  NODE_MODULES_ASSET_PREFIX,
  handleSocketIoRequest,
  isDevelopmentPath,
  isShellStaticPath,
  isSocketIoPath,
  isStaticPath,
  queryWithoutScope,
  scopeFromUrl,
  staticRequestUrl,
} from '/service-worker/routing.js'
import { stripScopeFromPath } from '/protocol/scope-url.js'

const BACKEND_READY_TIMEOUT_MS = 90000
const BACKEND_READY_POLL_MS = 100
const CHANNEL_RECOVERY_TIMEOUT_MS = 5000
const CHANNEL_RECOVERY_POLL_MS = 100
const instances = new InstanceRegistry()
const assetCache = new RuntimeAssetCache({
  fetchFn: (...args) => fetch(...args),
  cacheStorage: caches,
})
const callBackend = createBackendProxy({
  MessageChannelClass: MessageChannel,
  createBackendRequest,
  readBackendResponse,
  origin: self.location.origin,
  createAssociateClientMessage,
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('message', event => {
  if (isProtocolMessage(event.data, ProtocolMessageType.ASSOCIATE_CLIENT)) {
    instances.associateClient(event.source?.id, event.data.payload.scope)
    return
  }

  if (isProtocolMessage(event.data, ProtocolMessageType.CLEAR_OTHER_INSTANCES)) {
    // Compatibility with older clients. A service worker is shared by every
    // tab on the origin, so one client must never evict another playground.
    console.warn('[SW] Ignoring deprecated CLEAR_OTHER_INSTANCES message.')
    return
  }

  if (isProtocolMessage(event.data, ProtocolMessageType.CLAIM_CLIENTS)) {
    // Compatibility with older clients. Claiming belongs to the activate
    // event; a waiting worker throws InvalidStateError if it calls claim().
    console.warn('[SW] Ignoring deprecated CLAIM_CLIENTS message.')
    return
  }

  if (isProtocolMessage(event.data, ProtocolMessageType.INIT_CHANNEL)) {
    const scope = event.data.payload.scope
    const clientId = event.source?.id || event.data.payload.clientId
    const instance = instances.register(scope, event.ports[0], clientId)
    instance.port.onmessage = messageEvent => {
      if (isProtocolMessage(messageEvent.data, ProtocolMessageType.RUNTIME_READY)) {
        console.log(`[SW] Received READY from worker: ${scope}`)
        instance.ready = true
      }
    }
  }
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)

  if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/pyodide/')) {
    event.respondWith(assetCache.respond(event.request))
    return
  }

  if (url.origin !== self.location.origin) return

  const unscopedPath = stripScopeFromPath(url.pathname)
  if (!scopeFromUrl(url) && isShellStaticPath(unscopedPath)) return

  if (!scopeFromUrl(url) && isStaticPath(unscopedPath)) {
    if (!url.pathname.startsWith(NODE_MODULES_ASSET_PREFIX)) {
      event.respondWith(assetCache.respond(event.request))
      return
    }
  }

  event.respondWith(handleFetch(event, url))
})

async function handleFetch(event, url) {
  const requestPath = stripScopeFromPath(url.pathname)
  if (isDevelopmentPath(requestPath)) return fetch(event.request)

  const isShellNavigation = event.request.mode === 'navigate' && requestPath === '/'
  if (isShellNavigation && !scopeFromUrl(url)) return fetch(event.request)

  const clientUrl = event.clientId ? await getClientUrl(event.clientId) : null
  const clientScope = clientUrl ? scopeFromUrl(clientUrl) : null
  let scope = scopeFromUrl(url)
    || instances.scopeForClient(event.clientId)
    || clientScope
    || (!isShellNavigation && !isStaticPath(requestPath) && instances.onlyActiveScope())

  if (scope) {
    instances.associateClient(event.clientId, scope)
    instances.associateClient(event.resultingClientId, scope)
  }

  if (isStaticPath(requestPath)) {
    const staticUrl = staticRequestUrl(event.request.url)
    if (!scopeFromUrl(url) && staticUrl.href === event.request.url) {
      return assetCache.respond(event.request)
    }
    return assetCache.respond(event.request, staticUrl.href)
  }

  if (!scope) {
    console.log(`[SW] Fetching natively: ${event.request.url}`)
    return fetch(event.request)
  }

  if (instances.size === 0) {
    console.log('[SW] Instance registry empty; requesting channel recovery.')
    const recoveryChannel = new BroadcastChannel('sw-recovery')
    recoveryChannel.postMessage(createRecoveryRequestMessage())
    const recovered = await instances.waitUntilAvailable({
      timeoutMs: CHANNEL_RECOVERY_TIMEOUT_MS,
      pollMs: CHANNEL_RECOVERY_POLL_MS,
    })
    recoveryChannel.close()

    if (!recovered) {
      console.warn('[SW] Channel recovery timed out; releasing the request.')
      if (event.request.mode === 'navigate') return fetch(event.request)
      return new Response('Runtime connection unavailable', {
        status: 503,
        headers: { 'Retry-After': '1' },
      })
    }
  }

  if (!instances.get(scope)?.ready) {
    console.log(`[SW] Waiting for instance ready for scope: ${scope}`)
  }
  const ready = await instances.waitUntilReady(scope, {
    timeoutMs: BACKEND_READY_TIMEOUT_MS,
    pollMs: BACKEND_READY_POLL_MS,
  })
  if (!ready) {
    return new Response('Runtime instance did not become ready', {
      status: 503,
      headers: { 'Retry-After': '1' },
    })
  }
  const instance = instances.get(scope)

  if (isSocketIoPath(requestPath)) return handleSocketIoRequest(event.request, url)

  return callBackend({
    request: event.request,
    instance,
    scope,
    path: requestPath,
    query: queryWithoutScope(url),
  })
}

async function getClientUrl(clientId) {
  try {
    const client = await self.clients.get(clientId)
    return client ? new URL(client.url) : null
  } catch (_) {
    return null
  }
}
