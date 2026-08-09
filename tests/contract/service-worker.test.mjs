import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAssociateClientMessage,
} from '../../packages/protocol/src/messages.js'
import {
  createBackendRequest,
  createBackendResponse,
  readBackendResponse,
} from '../../packages/protocol/src/request.js'
import {
  createBackendProxy,
  rewriteScopedHtml,
} from '../../packages/service-worker/src/backend-proxy.js'
import { RuntimeAssetCache, hashString } from '../../packages/service-worker/src/cache.js'
import { InstanceRegistry } from '../../packages/service-worker/src/instance-registry.js'
import {
  addScopeToPath,
  scopeFromPath,
  stripScopeFromPath,
} from '../../packages/protocol/src/scope-url.js'
import {
  handleSocketIoRequest,
  isDevelopmentPath,
  isShellNavigation,
  isShellStaticPath,
  isSocketIoPath,
  isStaticPath,
  queryWithoutScope,
  scopeFromUrl,
  scopeRedirectLocation,
  staticRequestUrl,
} from '../../packages/service-worker/src/routing.js'

test('routing scopes backend requests and remaps deploy-safe static assets', () => {
  const backendUrl = new URL('https://playground.test/scope:tab-1/api/method/ping?x=1')
  assert.equal(scopeFromUrl(backendUrl), 'tab-1')
  assert.equal(queryWithoutScope(backendUrl), 'x=1')
  assert.equal(scopeFromPath('/scope:tab-1/api/method/ping'), 'tab-1')
  assert.equal(stripScopeFromPath('/scope:tab-1/api/method/ping'), '/api/method/ping')
  assert.equal(addScopeToPath('/api/method/ping', 'tab-1'), '/scope:tab-1/api/method/ping')
  assert.equal(
    scopeFromUrl(new URL('https://playground.test/api/method/ping?__scope=legacy')),
    'legacy',
  )
  assert.equal(isStaticPath('/protocol/messages.js'), true)
  assert.equal(isStaticPath('/runtime-config/packages.js'), true)
  assert.equal(isStaticPath('/service-worker/routing.js'), true)
  assert.equal(isStaticPath('/frontend/index-abc.js'), true)
  assert.equal(isStaticPath('/favicon.ico'), true)
  assert.equal(isShellStaticPath('/frontend/index-abc.js'), true)
  assert.equal(isShellStaticPath('/assets/frappe/js/frappe-web.js'), false)
  assert.equal(isDevelopmentPath('/@vite/client'), true)
  assert.equal(isDevelopmentPath('/@id/~icons/lucide/star'), true)
  assert.equal(isShellNavigation({
    mode: 'navigate',
    pathname: '/',
    explicitScope: null,
    clientFrameType: 'top-level',
  }), true)
  assert.equal(isShellNavigation({
    mode: 'navigate',
    pathname: '/',
    explicitScope: null,
    clientFrameType: 'nested',
  }), false)
  assert.equal(isShellNavigation({
    mode: 'navigate',
    pathname: '/',
    explicitScope: 'tab-1',
    clientFrameType: 'top-level',
  }), false)

  const staticUrl = staticRequestUrl(
    'https://playground.test/scope:tab-1/assets/frappe/node_modules/ace/index.js',
  )
  assert.equal(
    staticUrl.href,
    'https://playground.test/assets/frappe/runtime_modules/ace/index.js',
  )
})

test('redirect scoping applies only to same-origin backend locations', () => {
  const headers = new Headers({ Location: '/desk?view=list' })
  scopeRedirectLocation(headers, 'tab-1', 'https://playground.test')
  assert.equal(headers.get('Location'), '/scope:tab-1/desk?view=list')

  const root = new Headers({ Location: '/' })
  scopeRedirectLocation(root, 'tab-1', 'https://playground.test')
  assert.equal(root.get('Location'), '/scope:tab-1/')

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

  let availabilityClock = 0
  const emptyRegistry = new InstanceRegistry()
  const available = emptyRegistry.waitUntilAvailable({
    timeoutMs: 10,
    pollMs: 1,
    now: () => availabilityClock,
    sleep: async () => {
      availabilityClock += 1
      emptyRegistry.register('recovered', { name: 'port' }, 'client')
    },
  })
  assert.equal(await available, true)

  let recoveryClock = 0
  const recoveringRegistry = new InstanceRegistry()
  const recoveredScope = recoveringRegistry.waitForOnlyActiveScope({
    timeoutMs: 10,
    pollMs: 1,
    now: () => recoveryClock,
    sleep: async () => {
      recoveryClock += 1
      recoveringRegistry.register('restored-tab', { name: 'port' }, 'client')
    },
  })
  assert.equal(await recoveredScope, 'restored-tab')

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
    createAssociateClientMessage,
  })
  const response = await callBackend({
    request: new Request('https://playground.test/login', { method: 'POST', body: 'usr=admin' }),
    instance,
    scope: 'tab-1',
    path: '/login',
    query: '',
  })

  assert.equal(response.status, 302)
  assert.equal(response.headers.get('Location'), '/scope:tab-1/desk')
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp')
})

test('scoped HTML hides the virtual path before application scripts execute', () => {
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': '123',
  })
  const html = rewriteScopedHtml(
    '<!doctype html><html><head><script src="/app.js"></script></head></html>',
    headers,
    'tab-1',
    createAssociateClientMessage('tab-1'),
  )

  assert.match(html, /<head><script data-playground-scope-bootstrap>/)
  assert.ok(
    html.indexOf('data-playground-scope-bootstrap') < html.indexOf('src="/app.js"'),
  )
  assert.match(html, /history\.replaceState/)
  assert.match(html, /service-worker:associate-client/)
  assert.match(html, /controllerchange/)
  assert.match(html, /\.ready\.then/)
  assert.match(html, /window\.open/)
  assert.match(html, /target==='_blank'/)
  assert.match(html, /\/scope:tab-1/)
  assert.equal(headers.has('Content-Length'), false)
})

test('Socket.IO compatibility returns the expected polling handshake', async () => {
  const url = new URL('https://playground.test/socket.io/?EIO=4&transport=polling')
  assert.equal(isSocketIoPath(url.pathname), true)
  const response = handleSocketIoRequest(new Request(url), url)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /^0{"sid":"mock-sid-123"/)
})
