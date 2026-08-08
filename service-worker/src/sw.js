// Frappe Playground — Service Worker entry point
import {
  ProtocolMessageType,
  createBackendRequest,
  createRecoveryRequestMessage,
  isProtocolMessage,
  readBackendResponse,
} from '/protocol/index.js?v=2'
import { createBackendProxy } from '/service-worker/backend-proxy.js?v=1'
import { RuntimeAssetCache } from '/service-worker/cache.js?v=1'
import { InstanceRegistry } from '/service-worker/instance-registry.js?v=1'
import {
  NODE_MODULES_ASSET_PREFIX,
  isDevelopmentPath,
  isStaticPath,
  queryWithoutScope,
  scopeFromUrl,
  staticRequestUrl,
} from '/service-worker/routing.js?v=1'
import {
  handleSocketIoRequest,
  isSocketIoPath,
} from '/service-worker/socket-io.js?v=1'

const BACKEND_READY_TIMEOUT_MS = 90000
const BACKEND_READY_POLL_MS = 100
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
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('message', event => {
  if (isProtocolMessage(event.data, ProtocolMessageType.CLEAR_OTHER_INSTANCES)) {
    for (const scope of instances.clearExcept(event.data.payload.scope)) {
      console.log(`[SW] Cleared stale instance: ${scope}`)
    }
    return
  }

  if (isProtocolMessage(event.data, ProtocolMessageType.CLAIM_CLIENTS)) {
    self.clients.claim()
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

  if (!scopeFromUrl(url) && isStaticPath(url.pathname)) {
    if (!url.pathname.startsWith(NODE_MODULES_ASSET_PREFIX)) {
      event.respondWith(assetCache.respond(event.request))
      return
    }
  }

  event.respondWith(handleFetch(event, url))
})

async function handleFetch(event, url) {
  const requestPath = url.pathname
  if (isDevelopmentPath(requestPath)) return fetch(event.request)

  const isShellNavigation = event.request.mode === 'navigate' && requestPath === '/'
  if (isShellNavigation && !scopeFromUrl(url)) return fetch(event.request)

  const clientUrl = event.clientId ? await getClientUrl(event.clientId) : null
  const clientScope = clientUrl ? scopeFromUrl(clientUrl) : null
  let scope = scopeFromUrl(url)
    || instances.scopeForClient(event.clientId)
    || clientScope
    || (
      event.request.mode === 'navigate'
      && !isShellNavigation
      && !isStaticPath(requestPath)
      && instances.onlyActiveScope()
    )

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

    while (instances.size === 0) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    recoveryChannel.close()
    if (!scope) scope = instances.onlyActiveScope()
  }

  console.log(`[SW] Waiting for instance ready for scope: ${scope}`)
  await instances.waitUntilReady(scope, {
    timeoutMs: BACKEND_READY_TIMEOUT_MS,
    pollMs: BACKEND_READY_POLL_MS,
  })
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
