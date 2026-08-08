import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createBackendRequest,
  createBackendResponse,
  readBackendResponse,
} from '../../packages/protocol/src/index.js'
import { createBackendProxy } from '../../service-worker/src/backend-proxy.js'
import { RuntimeAssetCache, hashString } from '../../service-worker/src/cache.js'
import { InstanceRegistry } from '../../service-worker/src/instance-registry.js'
import {
  isDevelopmentPath,
  isStaticPath,
  queryWithoutScope,
  scopeFromUrl,
  scopeRedirectLocation,
  staticRequestUrl,
} from '../../service-worker/src/routing.js'
import {
  handleSocketIoRequest,
  isSocketIoPath,
} from '../../service-worker/src/socket-io.js'

test('routing scopes backend requests and remaps deploy-safe static assets', () => {
  const backendUrl = new URL('https://playground.test/api/method/ping?x=1&__scope=tab-1')
  assert.equal(scopeFromUrl(backendUrl), 'tab-1')
  assert.equal(queryWithoutScope(backendUrl), 'x=1')
  assert.equal(isStaticPath('/protocol/index.js'), true)
  assert.equal(isStaticPath('/service-worker/routing.js'), true)
  assert.equal(isDevelopmentPath('/@vite/client'), true)

  const staticUrl = staticRequestUrl(
    'https://playground.test/assets/frappe/node_modules/ace/index.js?__scope=tab-1',
  )
  assert.equal(
    staticUrl.href,
    'https://playground.test/assets/frappe/runtime_modules/ace/index.js',
  )
})

test('redirect scoping applies only to same-origin backend locations', () => {
  const headers = new Headers({ Location: '/desk?view=list' })
  scopeRedirectLocation(headers, 'tab-1', 'https://playground.test')
  assert.equal(headers.get('Location'), '/desk?view=list&__scope=tab-1')

  const external = new Headers({ Location: 'https://example.com/desk' })
  scopeRedirectLocation(external, 'tab-1', 'https://playground.test')
  assert.equal(external.get('Location'), 'https://example.com/desk')
})

test('instance registry owns client associations, readiness, and cleanup', async () => {
  const registry = new InstanceRegistry()
  const first = registry.register('tab-1', { name: 'port-1' }, 'client-1')
  registry.register('tab-2', { name: 'port-2' }, 'client-2')
  assert.equal(registry.scopeForClient('client-1'), 'tab-1')
  assert.deepEqual(registry.clearExcept('tab-1'), ['tab-2'])
  assert.equal(registry.scopeForClient('client-2'), null)
  assert.equal(registry.onlyActiveScope(), 'tab-1')

  let clock = 0
  const ready = registry.waitUntilReady('tab-1', {
    timeoutMs: 10,
    pollMs: 1,
    now: () => clock,
    sleep: async () => {
      clock += 1
      first.ready = true
    },
  })
  assert.equal(await ready, true)
})

test('runtime cache identity follows the Frappe assets manifest', async () => {
  const entries = new Map()
  const deleted = []
  const cache = {
    match: async key => entries.get(key),
    put: async (key, value) => entries.set(key, value),
  }
  const cacheStorage = {
    keys: async () => ['frappe-assets-old'],
    delete: async key => deleted.push(key),
    open: async () => cache,
  }
  const fetchFn = async value => {
    if (typeof value === 'string' && value.startsWith('/assets/assets.json')) {
      return new Response('{"app.js":"app.123.js"}')
    }
    return new Response('asset')
  }
  const runtimeCache = new RuntimeAssetCache({
    fetchFn,
    cacheStorage,
    now: () => 1,
    logger: { log() {}, warn() {} },
  })

  assert.equal(
    await runtimeCache.getCacheName(),
    `frappe-assets-${hashString('{"app.js":"app.123.js"}')}`,
  )
  assert.deepEqual(deleted, ['frappe-assets-old'])
  const request = new Request('https://playground.test/assets/app.js')
  assert.equal(await (await runtimeCache.respond(request)).text(), 'asset')
  assert.equal(entries.size, 1)
})

test('backend proxy translates protocol responses and scopes redirects', async () => {
  class FakeMessageChannel {
    constructor() {
      this.port1 = {}
      this.port2 = { name: 'response-port' }
      FakeMessageChannel.instance = this
    }
  }
  const instance = {
    port: {
      postMessage(payload, ports) {
        assert.equal(payload.payload.path, '/login')
        assert.equal(ports[0].name, 'response-port')
        FakeMessageChannel.instance.port1.onmessage({
          data: createBackendResponse({
            status: 302,
            headers: { Location: '/desk' },
            body: '',
          }),
        })
      },
    },
  }
  const callBackend = createBackendProxy({
    MessageChannelClass: FakeMessageChannel,
    createBackendRequest,
    readBackendResponse,
    origin: 'https://playground.test',
  })
  const response = await callBackend({
    request: new Request('https://playground.test/login', { method: 'POST', body: 'usr=admin' }),
    instance,
    scope: 'tab-1',
    path: '/login',
    query: '',
  })

  assert.equal(response.status, 302)
  assert.equal(response.headers.get('Location'), '/desk?__scope=tab-1')
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp')
})

test('Socket.IO compatibility returns the expected polling handshake', async () => {
  const url = new URL('https://playground.test/socket.io/?EIO=4&transport=polling')
  assert.equal(isSocketIoPath(url.pathname), true)
  const response = handleSocketIoRequest(new Request(url), url)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /^0{"sid":"mock-sid-123"/)
})
