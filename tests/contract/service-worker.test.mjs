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
  rewriteVirtualSiteUrls,
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
  isDocumentationPath,
  isShellNavigation,
  isShellStaticPath,
  isSocketIoPath,
  isStaticPath,
  queryWithoutScope,
  scopeFromUrl,
  scopeRedirectLocation,
  staticRequestUrl,
} from '../../packages/service-worker/src/routing.js'

test('app launcher routes stay in Frappe while catalog archives remain static', () => {
  for (const path of ['/apps', '/apps/', '/apps/example', '/appstore']) {
    assert.equal(isStaticPath(path), false)
  }
  assert.equal(isStaticPath('/apps/catalog.json'), true)
  assert.equal(isStaticPath('/apps/erpnext/app.zip'), true)
  const headers = new Headers({ Location: '/apps' })
  scopeRedirectLocation(headers, 'tab-1', 'https://playground.test')
  assert.equal(headers.get('Location'), '/scope:tab-1/apps')
})

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
  assert.equal(isStaticPath('/docs/architecture/index.html'), true)
  assert.equal(isDocumentationPath('/docs'), true)
  assert.equal(isDocumentationPath('/docs/assets/app.js'), true)
  assert.equal(isDocumentationPath('/documentation'), false)
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

test('redirect scoping preserves same-origin and virtual-site backend locations', () => {
  const headers = new Headers({ Location: '/desk?view=list' })
  scopeRedirectLocation(headers, 'tab-1', 'https://playground.test')
  assert.equal(headers.get('Location'), '/scope:tab-1/desk?view=list')

  const root = new Headers({ Location: '/' })
  scopeRedirectLocation(root, 'tab-1', 'https://playground.test')
  assert.equal(root.get('Location'), '/scope:tab-1/')

  const external = new Headers({ Location: 'https://example.com/desk' })
  scopeRedirectLocation(external, 'tab-1', 'https://playground.test')
  assert.equal(external.get('Location'), 'https://example.com/desk')

  const virtualSite = new Headers({ Location: 'http://site1/wiki/spaces' })
  scopeRedirectLocation(virtualSite, 'tab-1', 'https://playground.test')
  assert.equal(virtualSite.get('Location'), '/scope:tab-1/wiki/spaces')
})

test('instance registry owns client associations, readiness, and cleanup', async () => {
  const registry = new InstanceRegistry()
  const first = registry.register('tab-1', { name: 'port-1' }, 'client-1')
  registry.register('tab-2', { name: 'port-2' }, 'client-2')
  assert.equal(registry.scopeForClient('client-1'), 'tab-1')
  assert.equal(registry.onlyActiveScope(), null)
  assert.equal(registry.retire('tab-2', 'client-2'), true)
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

test('runtime cache identity follows Frappe assets, app catalog, and runtime manifest', async () => {
  const entries = new Map()
  const deleted = []
  const fetched = []
  const cache = {
    match: async key => entries.get(key)?.clone(),
    put: async (key, value) => entries.set(key, value),
  }
  const cacheStorage = {
    keys: async () => ['frappe-assets-old'],
    delete: async key => deleted.push(key),
    open: async () => cache,
  }
  const fetchFn = async value => {
    fetched.push(typeof value === 'string' ? value : value.url)
    if (typeof value === 'string' && value.startsWith('/assets/assets.json')) {
      return new Response('{"app.js":"app.123.js"}')
    }
    if (typeof value === 'string' && value.startsWith('/apps/catalog.json')) {
      return new Response('{"sourceCatalogSha256":"catalog.456"}')
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
    `frappe-assets-${hashString('{"app.js":"app.123.js"}\n{"sourceCatalogSha256":"catalog.456"}\nasset')}`,
  )
  assert.deepEqual(deleted, ['frappe-assets-old'])
  assert.equal(fetched.length, 3, 'initialization fetches only metadata')
  assert.equal(entries.size, 0, 'initialization does not prefetch assets')
  const request = new Request('https://playground.test/assets/app.js')
  assert.equal(await (await runtimeCache.respond(request)).text(), 'asset')
  assert.equal(entries.size, 1)
  assert.equal(await (await runtimeCache.respond(request)).text(), 'asset')
  assert.equal(fetched.filter(url => url === request.url).length, 1, 'repeat requests use the cache')
  const lazyRequest = new Request('https://playground.test/assets/locale/fr.json')
  assert.equal(fetched.includes(lazyRequest.url), false)
  await runtimeCache.respond(lazyRequest)
  assert.equal(fetched.filter(url => url === lazyRequest.url).length, 1)
  assert.equal(entries.size, 2)
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
        assert.equal(payload.payload.headers['x-frappe-site-name'], 'site1')
        assert.equal(ports[0].name, 'response-port')
        FakeMessageChannel.instance.port1.onmessage({
          data: createBackendResponse({
            status: 302,
            headers: { Location: '/desk', 'X-Playground-User-Id': 'Administrator' },
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
    request: new Request('https://playground.test/login', {
      method: 'POST',
      body: 'usr=admin',
      headers: { 'X-Frappe-Site-Name': 'playground.test' },
    }),
    instance,
    scope: 'tab-1',
    path: '/login',
    query: '',
  })

  assert.equal(response.status, 302)
  assert.equal(response.headers.get('Location'), '/scope:tab-1/desk')
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp')
  assert.equal(response.headers.has('X-Playground-User-Id'), false)
})

test('browser responses never expose the virtual site hostname', () => {
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' })
  const body = [
    'http://site1/wiki/spaces',
    'https://site1:8000/wiki/spaces',
    '//site1/wiki/spaces',
    'http:\\/\\/site1/wiki/spaces',
  ].join(' ')
  const rewritten = rewriteVirtualSiteUrls(body, headers, 'http://localhost:5173', 'tab-1')

  assert.doesNotMatch(rewritten, /site1/)
  assert.match(rewritten, /http:\/\/localhost:5173\/scope:tab-1\/wiki\/spaces/)
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
    'Administrator',
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
  assert.match(html, /window\.fetch/)
  assert.match(html, /XMLHttpRequest\.prototype\.open/)
  assert.match(html, /target\s*===\s*'_blank'/)
  assert.match(html, /\/scope:tab-1/)
  assert.match(html, /site1/)
  assert.match(html, /user_id=/)
  assert.match(html, /Administrator/)
  assert.equal(headers.has('Content-Length'), false)
})

test('Socket.IO compatibility completes a namespaced polling connection', async () => {
  const url = new URL('https://playground.test/socket.io/?EIO=4&transport=polling')
  assert.equal(isSocketIoPath(url.pathname), true)
  const response = await handleSocketIoRequest(new Request(url), url)
  assert.equal(response.status, 200)
  const handshake = await response.text()
  assert.match(handshake, /^0{"sid":"playground-/)
  const sid = JSON.parse(handshake.slice(1)).sid
  const sessionUrl = new URL(url)
  sessionUrl.searchParams.set('sid', sid)

  const posted = await handleSocketIoRequest(new Request(sessionUrl, {
    method: 'POST',
    body: '40/site1,',
  }), sessionUrl)
  assert.equal(posted.status, 200)
  assert.equal(await posted.text(), 'ok')

  const connected = await handleSocketIoRequest(new Request(sessionUrl), sessionUrl)
  assert.equal(connected.status, 200)
  assert.equal(await connected.text(), `40/site1,{"sid":"${sid}"}`)
})

test('Socket.IO compatibility retires an abandoned poll without a reconnect loop', async () => {
  const handshakeUrl = new URL('https://playground.test/socket.io/?EIO=4&transport=polling')
  const handshake = await handleSocketIoRequest(new Request(handshakeUrl), handshakeUrl)
  const sid = JSON.parse((await handshake.text()).slice(1)).sid
  const pollUrl = new URL(handshakeUrl)
  pollUrl.searchParams.set('sid', sid)

  const firstPoll = handleSocketIoRequest(new Request(pollUrl), pollUrl)
  const secondController = new AbortController()
  const secondPoll = handleSocketIoRequest(
    new Request(pollUrl, { signal: secondController.signal }),
    pollUrl,
  )

  assert.equal(await (await firstPoll).text(), '2')
  secondController.abort()
  assert.equal(await (await secondPoll).text(), '2')
})

test('backend requests settle and close their ports on timeout, abort, and malformed replies', async () => {
  for (const mode of ['timeout', 'abort', 'malformed', 'send-error']) {
    let channel
    let timeout
    let closed = 0
    const controller = new AbortController()
    const call = createBackendProxy({
      MessageChannelClass: class { constructor() {
        channel = this
        this.port1 = { close() { closed++ } }
        this.port2 = { close() { closed++ } }
      } },
      createBackendRequest, readBackendResponse, createAssociateClientMessage,
      origin: 'https://playground.test',
      setTimeoutFn: callback => { timeout = callback; return 1 }, clearTimeoutFn() {},
    })
    const result = call({ request: new Request('https://playground.test/ping', { signal: controller.signal }),
      instance: { port: { postMessage() { if (mode === 'send-error') throw new Error('closed') } } },
      scope: 'test', path: '/ping', query: '',
    })
    if (mode === 'timeout') timeout()
    if (mode === 'abort') controller.abort()
    if (mode === 'malformed') channel.port1.onmessage({ data: {} })
    assert.equal((await result).status, mode === 'timeout' ? 504 : mode === 'abort' ? 499 : 503)
    assert.equal(closed, 2)
  }
})

test('registry retirement only removes the owning client and closes replaced ports', () => {
  const registry = new InstanceRegistry()
  let closed = 0
  const port = () => ({ close() { closed++ } })
  registry.register('test', port(), 'old')
  registry.register('test', port(), 'new')
  assert.equal(closed, 1)
  assert.equal(registry.retire('test', 'old'), false)
  assert.equal(registry.retire('test', 'new'), true)
  assert.equal(closed, 2)
  assert.equal(registry.size, 0)
  assert.equal(registry.scopeForClient('old'), null)
})

test('generated bootstrap executes scoped fetch, popup, and cookie behavior', async () => {
  const { runInNewContext } = await import('node:vm')
  const { SCOPE_BOOTSTRAP_SOURCE: generated } = await import('../../artifacts/generated/scope-bootstrap.js')
  const { SCOPE_BOOTSTRAP_SOURCE: authored } = await import('../../packages/service-worker/src/scope-bootstrap.js')
  assert.equal(generated, authored)
  const calls = []
  const listeners = new Map()
  const document = Object.create({ get cookie() { return 'user_id=Other; theme=dark' }, set cookie(value) { calls.push(value) } })
  const context = {
    document, URL, Request,
    navigator: { serviceWorker: { controller: { postMessage() {} }, addEventListener() {}, ready: Promise.resolve() } },
    location: new URL('https://playground.test/scope:example/desk'),
    history: { replaceState: (...args) => calls.push(args[2]) },
    addEventListener: (type, callback) => listeners.set(type, callback),
    XMLHttpRequest: class { open() {} },
    window: { fetch: input => calls.push(typeof input === 'string' ? input : input.url), open: url => calls.push(url) },
  }
  const html = rewriteScopedHtml('<head></head>', new Headers({ 'Content-Type': 'text/html' }),
    'example', createAssociateClientMessage('example'), 'Admin</script>')
  assert.equal((html.match(/<\/script>/g) || []).length, 1)
  const script = html.slice(html.indexOf('>') + 1).replace(/^<script[^>]*>/, '').split('</script>')[0]
  runInNewContext(script, context)
  context.window.fetch('/api/method/ping')
  context.window.open('http://site1/wiki')
  context.window.fetch('https://external.test/api')
  assert.deepEqual(calls, ['/desk', 'https://playground.test/scope:example/api/method/ping',
    'https://playground.test/scope:example/wiki', 'https://external.test/api'])
  assert.equal(document.cookie, 'theme=dark; user_id=Admin%3C%2Fscript%3E')
})
