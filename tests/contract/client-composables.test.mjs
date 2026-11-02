import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'

import { useFrameNavigation } from '../../packages/client/src/composables/use-frame-navigation.js'
import { useInstanceManager } from '../../packages/client/src/composables/use-instance-manager.js'
import { useAppManager } from '../../packages/client/src/composables/use-app-manager.js'
import { usePlaygroundLifecycle } from '../../packages/client/src/composables/use-playground-lifecycle.js'
import { createSiteApi } from '../../packages/client/src/playground/site-api.js'
import { processBootFlags } from '../../packages/client/src/playground/boot-flags.js'
import { PlaygroundEventType } from '../../packages/client/src/playground/controller.js'
import { RuntimeStage } from '../../packages/protocol/src/messages.js'
import {
  PLAYGROUND_COUNTRY_KEY,
  resolveBootLocale,
} from '../../packages/client/src/playground/boot-locale.js'
import {
  PLAYGROUND_INSTANCES_KEY,
  PLAYGROUND_SESSION_KEY,
  createInstanceSession,
  listInstanceSessions,
} from '../../packages/client/src/playground/session.js'

function withVueApp(setupFn) {
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode() {},
    nextSibling() {},
  })
  let result
  const app = renderer.createApp({
    setup() {
      result = setupFn()
      return () => null
    },
  })
  const root = {}
  app.mount(root)
  return {
    result,
    unmount: () => app.unmount(),
  }
}

function createMemoryStorage() {
  const store = new Map()
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    clear: () => store.clear(),
  }
}

test('useFrameNavigation manages frame URL scoping and navigation commands', () => {
  const oldWindow = globalThis.window
  const oldDocument = globalThis.document
  const windowListeners = new Map()

  globalThis.window = {
    location: { origin: 'http://localhost:5173', search: '' },
    addEventListener(type, fn) { windowListeners.set(type, fn) },
    removeEventListener(type, fn) { windowListeners.delete(type) },
  }
  globalThis.document = {
    documentElement: {
      classList: {
        add() {},
        remove() {},
        contains() { return false },
      },
      getAttribute() { return null },
    },
  }

  try {
    const ready = ref(false)
    const instanceId = ref('test-instance')
    const { result: frame, unmount } = withVueApp(() => useFrameNavigation({ ready, instanceId }))

    assert.equal(frame.address.value, '/')
    assert.equal(frame.frameSrc.value, '')

    // navigateFrame when not ready should not change frameSrc
    frame.address.value = '/desk'
    frame.navigateFrame()
    assert.equal(frame.frameSrc.value, '')

    // navigateFrame when ready should update frameSrc
    ready.value = true
    frame.navigateFrame()
    assert.equal(frame.frameSrc.value, '/scope:test-instance/desk')

    // reloadFrame re-assigns DOM element src
    const mockIframe = { src: '' }
    frame.iframeRef.value = mockIframe
    frame.reloadFrame()
    assert.equal(mockIframe.src, '/scope:test-instance/desk')

    // resetFrame clears src and resets address
    frame.resetFrame()
    assert.equal(frame.frameSrc.value, '')
    assert.equal(frame.address.value, '/')

    unmount()
  } finally {
    globalThis.window = oldWindow
    globalThis.document = oldDocument
  }
})

test('useFrameNavigation syncs address, prefill, and dark mode from iframe window', () => {
  const oldWindow = globalThis.window
  const oldDocument = globalThis.document
  const darkClasses = new Set()

  globalThis.window = {
    location: { origin: 'http://localhost:5173', search: '' },
    addEventListener() {},
    removeEventListener() {},
  }
  globalThis.document = {
    documentElement: {
      classList: {
        add(c) { darkClasses.add(c) },
        remove(c) { darkClasses.delete(c) },
        contains(c) { return darkClasses.has(c) },
      },
      getAttribute(attr) { return attr === 'data-theme' ? 'dark' : null },
    },
  }

  try {
    const ready = ref(true)
    const instanceId = ref('my-inst')
    const { result: frame, unmount } = withVueApp(() => useFrameNavigation({ ready, instanceId }))

    const iframeListeners = new Map()
    const emailInput = { value: '', setAttribute(k, v) { this[k] = v }, dispatchEvent() {} }
    const pwdInput = { value: '', setAttribute(k, v) { this[k] = v }, dispatchEvent() {} }
    const headChildren = []

    const mockDoc = {
      querySelector(selector) {
        if (selector === '#login_email') return emailInput
        if (selector === '#login_password') return pwdInput
        return null
      },
      head: {
        appendChild(el) { headChildren.push(el) },
      },
      getElementById(id) {
        return headChildren.find(el => el.id === id) || null
      },
      createElement(tag) { return { tag, id: '', textContent: '' } },
      documentElement: {
        getAttribute(attr) { return attr === 'data-theme' ? 'dark' : null },
        classList: { contains() { return true } },
      },
    }

    const mockWindow = {
      location: { href: 'http://localhost:5173/scope:my-inst/desk#workspace/Home?_frappe_playground_bounce=123' },
      document: mockDoc,
      addEventListener(type, fn) { iframeListeners.set(type, fn) },
      removeEventListener(type, fn) { iframeListeners.delete(type) },
    }

    frame.iframeRef.value = {
      contentWindow: mockWindow,
    }

    frame.syncAddressFromFrame()

    // Address stripped scope and bounce parameter
    assert.equal(frame.address.value, '/desk#workspace/Home')

    // Listeners attached to iframe window
    assert.equal(iframeListeners.has('hashchange'), true)
    assert.equal(iframeListeners.has('popstate'), true)

    // Dark mode applied to documentElement
    assert.equal(darkClasses.has('dark'), true)

    // Password inputs prefilled
    assert.equal(emailInput.value, 'Administrator')
    assert.equal(pwdInput.value, 'admin')

    // Safari fix injected
    assert.equal(headChildren.some(el => el.id === 'safari-pwd-fix'), true)

    frame.stopAddressSync()
    assert.equal(iframeListeners.size, 0)

    unmount()
  } finally {
    globalThis.window = oldWindow
    globalThis.document = oldDocument
  }
})

test('useInstanceManager handles instance creation, selection, rename, and deletion', async () => {
  const oldStorage = globalThis.localStorage
  const oldIndexedDB = globalThis.indexedDB
  const oldWindow = globalThis.window

  const memoryStore = createMemoryStorage()
  globalThis.localStorage = memoryStore
  globalThis.window = {
    location: { origin: 'http://localhost:5173', search: '' },
    addEventListener() {},
    removeEventListener() {},
  }

  const deletedDatabases = []
  globalThis.indexedDB = {
    deleteDatabase(name) {
      deletedDatabases.push(name)
      const req = {}
      queueMicrotask(() => req.onsuccess?.())
      return req
    },
  }

  try {
    const instance1 = createInstanceSession({ storage: memoryStore, name: 'Playground A' })
    const instance2 = createInstanceSession({ storage: memoryStore, name: 'Playground B' })

    const instanceId = ref(instance1.id)
    const instances = ref(listInstanceSessions({ storage: memoryStore }))
    const initCalls = []
    let stopped = 0

    const { result: manager, unmount } = withVueApp(() => useInstanceManager({
      instanceId,
      instances,
      initPlayground: opts => initCalls.push(opts),
      stopPlayground: () => stopped++,
      failPlayground: () => {},
    }))

    // On mount with empty search flags, initPlayground is called
    assert.equal(initCalls.length, 1)

    // Select another instance
    manager.selectInstance(instance2.id)
    assert.equal(initCalls.length, 2)
    assert.deepEqual(initCalls[1], { instanceId: instance2.id })

    // Selecting current instance does nothing
    manager.selectInstance(instance1.id)
    assert.equal(initCalls.length, 2)

    // Rename instance
    manager.renameInstance({ id: instance1.id, name: 'Renamed Alpha' })
    const found = instances.value.find(i => i.id === instance1.id)
    assert.equal(found.name, 'Renamed Alpha')

    // Reset instance (wipe database and reinit fresh)
    await manager.resetInstance(instance1.id)
    assert.equal(stopped, 1)
    assert.equal(deletedDatabases.includes(`frappe_playground_db_${instance1.id}`), true)

    // Delete instance
    await manager.deleteInstance(instance2.id)
    assert.equal(instances.value.some(i => i.id === instance2.id), false)
    assert.equal(deletedDatabases.includes(`frappe_playground_db_${instance2.id}`), true)

    unmount()
  } finally {
    globalThis.localStorage = oldStorage
    globalThis.indexedDB = oldIndexedDB
    globalThis.window = oldWindow
  }
})

test('useAppManager manages catalog state, install, uninstall, and view refreshing', async () => {
  let refreshed = 0
  const installed = new Set(['wiki'])
  const fakePlayground = {
    disposed: false,
    listInstalledApps: () => [...installed],
    installApp: async id => { installed.add(id) },
    uninstallApp: async id => { installed.delete(id) },
  }

  const catalog = {
    apps: [
      { id: 'wiki', title: 'Frappe Wiki' },
      { id: 'insights', title: 'Frappe Insights' },
    ],
  }

  const { result: appManager, unmount } = withVueApp(() => useAppManager(() => fakePlayground, {
    loadCatalog: async () => catalog,
    refreshView: () => { refreshed++ },
  }))

  assert.equal(appManager.showAppManager.value, false)
  await appManager.openAppManager()
  assert.equal(appManager.showAppManager.value, true)
  assert.deepEqual(appManager.availableApps.value, catalog.apps)
  assert.deepEqual(appManager.installedApps.value, ['wiki'])

  // Install app
  await appManager.installApp('insights')
  assert.equal(installed.has('insights'), true)
  assert.equal(appManager.appOperationNotice.value.type, 'success')
  assert.equal(refreshed, 1)

  // Uninstall app
  await appManager.uninstallApp('wiki')
  assert.equal(installed.has('wiki'), false)
  assert.equal(refreshed, 2)

  // Reset app state
  appManager.resetAppState()
  assert.equal(appManager.showAppManager.value, false)
  assert.deepEqual(appManager.installedApps.value, [])

  unmount()
})

test('resolveBootLocale uses cached country and handles fallback gracefully', async () => {
  const store = createMemoryStorage()
  store.setItem(PLAYGROUND_COUNTRY_KEY, 'Germany')

  const locale = await resolveBootLocale({
    storage: store,
    languageTag: 'de-DE',
  })

  assert.equal(locale.language, 'de')
  assert.equal(locale.country, 'Germany')
  assert.equal(typeof locale.timeZone, 'string')
})

test('createSiteApi routes requests to scoped frame URL and surfaces Frappe error messages', async () => {
  const requests = []
  const mockFetch = async (url, options) => {
    requests.push({ url, options })
    if (url.includes('/api/method/success')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ message: 'success' }),
      }
    }
    if (url.includes('/api/method/with_server_messages')) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          _server_messages: JSON.stringify(['Custom validation error occurred']),
        }),
      }
    }
    return {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => { throw new Error('not json') },
    }
  }

  const siteApi = createSiteApi({ instanceId: 'test-inst', fetchFn: mockFetch })
  const res = await siteApi('/api/method/success', { method: 'POST' }, 'Success call')
  assert.equal(res.ok, true)
  assert.match(requests[0].url, /\/scope:test-inst\/api\/method\/success/)

  await assert.rejects(
    () => siteApi('/api/method/with_server_messages', {}, 'Failing call'),
    /Failing call failed: 400 Bad Request — Custom validation error occurred/,
  )

  await assert.rejects(
    () => siteApi('/api/method/server_error', {}, 'Server error'),
    /Server error failed: 500 Internal Server Error/,
  )
})

test('processBootFlags installs requested apps, performs auto-login and onboarding completion', async () => {
  const installed = []
  const apiCalls = []
  const playground = {
    listInstalledApps: () => [...installed],
  }
  const mockSiteApi = () => async (path, options, action) => {
    apiCalls.push({ path, options, action })
    return { ok: true, json: async () => ({}) }
  }

  const mockDoc = {
    cookie: 'user_id=Administrator; csrf_token=test-csrf-12345; sid=xyz',
  }

  const params = new URLSearchParams('apps=crm,helpdesk&login=1&onboarding=0&path=/desk')
  const result = await processBootFlags(params, {
    playground,
    instanceId: 'inst-1',
    installApp: async appId => { installed.push(appId) },
    document: mockDoc,
    createSiteApiFn: mockSiteApi,
    resolveLocaleFn: async () => ({ language: 'en', country: 'United States', timeZone: 'America/New_York' }),
    logger: { log() {} },
  })

  assert.equal(result.autoLogin, true)
  assert.equal(result.skipOnboarding, true)
  assert.equal(result.initialPath, '/desk')
  assert.deepEqual(installed, ['crm', 'helpdesk'])

  // Check login API call
  assert.equal(apiCalls[0].path, '/api/method/login')
  assert.equal(apiCalls[0].action, 'Auto-login')

  // Check setup_complete API call with CSRF token from document.cookie
  assert.equal(apiCalls[1].path, '/api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete')
  assert.equal(apiCalls[1].options.headers['X-Frappe-CSRF-Token'], 'test-csrf-12345')
  const payload = JSON.parse(apiCalls[1].options.body)
  assert.equal(payload.args.country, 'United States')
  assert.equal(payload.args.language, 'en')
})

test('usePlaygroundLifecycle manages boot lifecycle, progress tracking, and error handling', async () => {
  const listeners = new Map()
  let disposed = false
  let resolveReady
  const readyPromise = new Promise(resolve => { resolveReady = resolve })

  const fakePlayground = {
    disposed: false,
    abortController: new AbortController(),
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
    },
    emit(event, data) {
      for (const handler of listeners.get(event) || []) handler(data)
    },
    async start() {
      return { id: 'test-session-id', freshSession: true }
    },
    async waitUntilReady() {
      await readyPromise
    },
    listInstalledApps() { return ['frappe'] },
    dispose() { disposed = true },
  }

  const fakeWindow = {
    location: { search: '', pathname: '/' },
    history: { replaceState: () => {} },
  }

  const { result: lifecycle, unmount } = withVueApp(() => {
    return usePlaygroundLifecycle({
      createRuntime: () => fakePlayground,
      listSessions: () => [{ id: 'test-session-id', name: 'Test' }],
      processFlags: async () => ({
        initialPath: '/desk',
        autoLogin: false,
        skipOnboarding: false,
      }),
      window: fakeWindow,
    })
  })

  assert.equal(lifecycle.runtimeState.value, 'idle')
  assert.equal(lifecycle.ready.value, false)

  // Start initialization
  const initPromise = lifecycle.initPlayground()
  assert.equal(lifecycle.runtimeState.value, 'starting')
  assert.equal(lifecycle.booting.value, true)

  // Simulate progress while waiting for ready
  fakePlayground.emit(PlaygroundEventType.PROGRESS, {
    stage: RuntimeStage.SERVICE_WORKER,
    status: 'active',
  })
  assert.equal(lifecycle.bootSteps.value[0].status, 'active')

  fakePlayground.emit(PlaygroundEventType.PROGRESS, {
    stage: RuntimeStage.SERVICE_WORKER,
    status: 'done',
  })
  assert.equal(lifecycle.bootSteps.value[0].status, 'done')

  // Resolve readiness and await completion
  resolveReady()
  await initPromise

  assert.equal(lifecycle.runtimeState.value, 'ready')
  assert.equal(lifecycle.ready.value, true)
  assert.equal(lifecycle.instanceId.value, 'test-session-id')
  assert.equal(lifecycle.showIntroDialog.value, true)

  // Test failure path
  lifecycle.failPlayground(new Error('Fatal runtime error'))
  assert.equal(lifecycle.runtimeState.value, 'failed')
  assert.equal(lifecycle.bootError.value, 'Fatal runtime error')

  unmount()
  assert.equal(disposed, true)
})
