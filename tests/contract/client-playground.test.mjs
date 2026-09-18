import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ProtocolMessageType,
  RuntimeStage,
  createRuntimeLogMessage,
  createRuntimeReadyMessage,
  createAppInstallResultMessage,
  createAppUninstallResultMessage,
} from '../../packages/protocol/src/messages.js'
import {
  PlaygroundController,
  PlaygroundEventType,
} from '../../packages/client/src/playground/controller.js'
import {
  normalizeAddress,
  scopedFrameUrl,
  stripScope,
} from '../../packages/client/src/playground/iframe-navigation.js'
import {
  PLAYGROUND_INSTANCES_KEY,
  PLAYGROUND_SESSION_KEY,
  createInstanceSession,
  deleteInstanceData,
  getOrCreateInstanceSession,
  listInstanceSessions,
  removeInstanceSession,
  renameInstanceSession,
  selectInstanceSession,
} from '../../packages/client/src/playground/session.js'
import {
  RUNTIME_BUILD_ID,
  runtimeEntryUrl,
} from '../../packages/client/src/playground/runtime-version.js'
import { loadAppCatalog } from '../../packages/client/src/playground/apps.js'

const INSTANCE_ID_REGEX = /^[a-z0-9]+-[a-z0-9]+$/

function memoryStorage() {
  const values = new Map()
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
}

test('client app catalog loader validates generated metadata', async () => {
  const app = {
    id: 'wiki',
    title: 'Wiki',
    description: 'Knowledge base',
    version: '3.0.0',
    license: 'MIT',
    experimental: true,
    frappeVersion: '>=16 <17',
    archive: 'apps/wiki/app.zip',
    assetPrefix: '/assets/wiki',
    packageRoot: 'wiki',
    archiveExcludes: ['public'],
    pythonDependencies: ['mistune>=3'],
    source: { repository: 'https://example.com/wiki.git', ref: 'a'.repeat(40) },
    archiveBytes: 10,
    archiveSha256: 'b'.repeat(64),
  }
  const catalog = await loadAppCatalog({
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        schemaVersion: 1,
        sourceCatalogSha256: 'c'.repeat(64),
        apps: [app],
      }),
    }),
  })
  assert.equal(catalog.apps[0].id, 'wiki')
  await assert.rejects(
    loadAppCatalog({ fetchFn: async () => ({ ok: false, status: 503 }) }),
    /Could not load the app catalog \(503\)/,
  )
})

test('instance sessions are created once and restored on reload', () => {
  const storage = memoryStorage()
  const options = {
    storage,
    now: () => 100,
  }

  const session1 = getOrCreateInstanceSession(options)
  assert.match(session1.id, INSTANCE_ID_REGEX)
  assert.equal(session1.name, 'My Playground')
  assert.equal(session1.createdAt, 100)
  assert.equal(session1.lastOpenedAt, 100)
  assert.equal(session1.freshSession, true)

  assert.equal(storage.getItem(PLAYGROUND_SESSION_KEY), session1.id)

  const session2 = getOrCreateInstanceSession(options)
  assert.equal(session2.id, session1.id)
  assert.equal(session2.name, 'My Playground')
  assert.equal(session2.createdAt, 100)
  assert.equal(session2.lastOpenedAt, 100)
  assert.equal(session2.freshSession, false)
})

test('instance catalog creates and selects independent playgrounds', () => {
  const storage = memoryStorage()
  let timestamp = 100
  const options = {
    storage,
    now: () => timestamp++,
  }

  const first = createInstanceSession({ ...options, name: 'Accounting' })
  const second = createInstanceSession(options)

  assert.match(first.id, INSTANCE_ID_REGEX)
  assert.match(second.id, INSTANCE_ID_REGEX)
  assert.notEqual(first.id, second.id)
  assert.equal(first.name, 'Accounting')
  assert.equal(second.name, 'Playground 2')
  assert.equal(storage.getItem(PLAYGROUND_SESSION_KEY), second.id)

  const sessions = listInstanceSessions({ storage }).map(instance => instance.id)
  assert.deepEqual(sessions, [first.id, second.id])

  const selectedFirst = selectInstanceSession(first.id, { storage, now: () => 200 })
  assert.equal(selectedFirst.id, first.id)
  assert.equal(selectedFirst.name, 'Accounting')
  assert.equal(selectedFirst.createdAt, 100)
  assert.equal(selectedFirst.lastOpenedAt, 200)
  assert.equal(selectedFirst.freshSession, false)

  assert.equal(storage.getItem(PLAYGROUND_SESSION_KEY), first.id)
  assert.equal(selectInstanceSession('missing', { storage }), null)
})

test('legacy instance identity is migrated into the catalog', () => {
  const storage = memoryStorage()
  storage.setItem(PLAYGROUND_SESSION_KEY, 'legacy-instance')

  const session = getOrCreateInstanceSession({ storage, now: () => 500 })

  assert.equal(session.id, 'legacy-instance')
  assert.equal(session.freshSession, false)
  assert.equal(JSON.parse(storage.getItem(PLAYGROUND_INSTANCES_KEY))[0].id, 'legacy-instance')
})

test('instances can be removed with a safe active-session fallback', () => {
  const storage = memoryStorage()
  const options = {
    storage,
    now: () => 100,
  }
  const first = createInstanceSession(options)
  const second = createInstanceSession(options)

  assert.deepEqual(removeInstanceSession(second.id, { storage }).map(item => item.id), [
    first.id,
  ])
  assert.equal(storage.getItem(PLAYGROUND_SESSION_KEY), first.id)
  assert.deepEqual(removeInstanceSession(first.id, { storage }), [])
  assert.equal(storage.getItem(PLAYGROUND_SESSION_KEY), null)
})

test('instances can be renamed without changing their identity', () => {
  const storage = memoryStorage()
  const first = createInstanceSession({
    storage,
    now: () => 100,
  })

  const renamed = renameInstanceSession(first.id, '  Sales Demo  ', { storage })
  assert.equal(renamed.id, first.id)
  assert.equal(renamed.name, 'Sales Demo')
  assert.equal(renamed.createdAt, 100)
  assert.equal(renamed.lastOpenedAt, 100)
  assert.equal(storage.getItem(PLAYGROUND_SESSION_KEY), first.id)

  assert.throws(() => renameInstanceSession(first.id, ' ', { storage }), {
    name: 'TypeError',
  })
  assert.equal(renameInstanceSession('missing', 'Name', { storage }), null)
})

test('instance data deletion targets only its scoped IndexedDB database', async () => {
  let databaseName
  const indexedDB = {
    deleteDatabase(name) {
      databaseName = name
      const request = {}
      queueMicrotask(() => request.onsuccess())
      return request
    },
  }

  await deleteInstanceData('instance-1', { indexedDB })
  assert.equal(databaseName, 'frappe_playground_db_instance-1')
})

test('worker entry URLs share the build-derived runtime identity', () => {
  assert.equal(RUNTIME_BUILD_ID, 'test')
  assert.equal(runtimeEntryUrl('/sw.js'), '/sw.js?build=test')
  assert.equal(runtimeEntryUrl('/worker.js', 'abc123'), '/worker.js?build=abc123')
})

test('iframe navigation scopes backend URLs without exposing scope in the address bar', () => {
  const origin = 'https://playground.example'
  assert.equal(normalizeAddress('desk?view=list#main', origin), '/desk?view=list#main')
  assert.equal(
    scopedFrameUrl('/desk?view=list#main', 'instance-1', origin),
    '/scope:instance-1/desk?view=list#main',
  )
  assert.equal(
    stripScope('/scope:instance-1/desk?view=list#main', origin),
    '/desk?view=list#main',
  )
  assert.equal(
    stripScope('/desk?view=list&__scope=instance-1#main', origin),
    '/desk?view=list#main',
  )
})

test('the controller owns lifecycle wiring and emits structured progress', async () => {
  const serviceWorkerMessages = []
  const workerMessages = []
  let serviceWorkerUpdateChecks = 0
  let serviceWorkerRegistrationOptions
  const controllerWorker = {
    postMessage: (...args) => serviceWorkerMessages.push(args),
  }
  const serviceWorker = {
    controller: controllerWorker,
    addEventListener() {},
    removeEventListener() {},
    async register(_url, options) {
      serviceWorkerRegistrationOptions = options
      return {
        active: controllerWorker,
        update() {
          serviceWorkerUpdateChecks += 1
          return new Promise(() => {})
        },
      }
    },
    ready: Promise.resolve({ active: controllerWorker }),
  }
  const documentListeners = new Map()
  const scheduledDelays = []
  const document = {
    visibilityState: 'visible',
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    removeEventListener: type => documentListeners.delete(type),
  }

  class FakeWorker {
    constructor(url, options) {
      this.url = url
      this.options = options
      FakeWorker.instance = this
    }
    postMessage(...args) {
      workerMessages.push(args)
    }
    terminate() {
      this.terminated = true
    }
  }

  class FakeMessageChannel {
    constructor() {
      this.port1 = { name: 'service-worker-port' }
      this.port2 = { name: 'server-port' }
    }
  }

  class FakeBroadcastChannel {
    close() {
      this.closed = true
    }
  }

  const controller = new PlaygroundController({
    navigator: { serviceWorker },
    document,
    location: { reload() {} },
    WorkerClass: FakeWorker,
    MessageChannelClass: FakeMessageChannel,
    BroadcastChannelClass: FakeBroadcastChannel,
    storage: memoryStorage(),
    setTimeoutFn: (callback, delay) => {
      scheduledDelays.push(delay)
      if (delay === 2000) callback()
      return 1
    },
    clearTimeoutFn() {},
  })
  const progress = []
  const ready = []
  controller.on(PlaygroundEventType.PROGRESS, event => progress.push(event))
  controller.on(PlaygroundEventType.READY, event => ready.push(event))

  const session = await controller.start()
  assert.match(session.id, INSTANCE_ID_REGEX)
  assert.equal(session.name, 'My Playground')
  assert.equal(session.freshSession, true)
  assert.equal(typeof session.createdAt, 'number')
  assert.equal(typeof session.lastOpenedAt, 'number')
  assert.equal(serviceWorkerUpdateChecks, 0)
  assert.deepEqual(serviceWorkerRegistrationOptions, {
    type: 'module',
    updateViaCache: 'none',
  })
  assert.equal(FakeWorker.instance.options.type, 'module')

  const workerUrlObj = new URL(FakeWorker.instance.url, 'http://localhost')
  assert.equal(workerUrlObj.pathname, '/worker.js')
  assert.equal(workerUrlObj.searchParams.get('build'), 'test')
  assert.equal(workerUrlObj.searchParams.get('scope'), session.id)
  assert.equal(workerUrlObj.searchParams.get('fresh'), 'true')
  assert.equal(serviceWorkerMessages[0][0].type, ProtocolMessageType.INIT_CHANNEL)
  assert.equal(workerMessages[0][0].type, ProtocolMessageType.INIT_CHANNEL)

  documentListeners.get('visibilitychange')()
  assert.equal(serviceWorkerUpdateChecks, 1)

  FakeWorker.instance.onmessage({
    data: createRuntimeLogMessage('Loading Pyodide...', RuntimeStage.PYTHON),
  })
  FakeWorker.instance.onmessage({ data: createRuntimeReadyMessage({ installedApps: [] }) })
  FakeWorker.instance.onmessage({ data: createRuntimeReadyMessage() })

  assert.equal(progress.some(event => event.stage === RuntimeStage.PYTHON), true)
  assert.deepEqual(ready, [{ instanceId: session.id }])

  const installation = controller.installApp('wiki')
  const installMessage = workerMessages.at(-1)[0]
  assert.equal(installMessage.type, ProtocolMessageType.APP_INSTALL)
  assert.equal(installMessage.payload.appId, 'wiki')
  FakeWorker.instance.onmessage({
    data: createAppInstallResultMessage(installMessage.payload.requestId, 'wiki', {
      installed: true,
    }),
  })
  assert.equal((await installation).installed, true)
  assert.deepEqual(controller.listInstalledApps(), ['wiki'])

  const uninstall = controller.uninstallApp('wiki')
  assert.equal(scheduledDelays.at(-1), 600000)
  const uninstallMessage = workerMessages.at(-1)[0]
  assert.equal(uninstallMessage.type, ProtocolMessageType.APP_UNINSTALL)
  FakeWorker.instance.onmessage({
    data: createAppUninstallResultMessage(uninstallMessage.payload.requestId, 'wiki', {
      uninstalled: true,
    }),
  })
  assert.equal((await uninstall).uninstalled, true)
  assert.deepEqual(controller.listInstalledApps(), [])

  controller.dispose()
  assert.equal(FakeWorker.instance.terminated, true)
  assert.equal(documentListeners.size, 0)
})

test('the controller waits for the versioned worker when a legacy worker controls the page', async () => {
  const listeners = new Set()
  const serviceWorker = {
    controller: { scriptURL: 'http://localhost:5173/sw.js' },
    addEventListener(type, listener) {
      if (type === 'controllerchange') listeners.add(listener)
    },
    removeEventListener(type, listener) {
      if (type === 'controllerchange') listeners.delete(listener)
    },
  }
  const controller = new PlaygroundController({
    location: { href: 'http://localhost:5173/' },
    setTimeoutFn: callback => setTimeout(callback, 100),
    clearTimeoutFn: clearTimeout,
  })

  assert.equal(controller.options.serviceWorkerUrl, '/sw.js?build=test')
  assert.equal(controller.isExpectedServiceWorker(serviceWorker.controller), false)

  const ready = controller.waitForExpectedServiceWorker(serviceWorker)
  serviceWorker.controller = { scriptURL: 'http://localhost:5173/sw.js?build=test' }
  for (const listener of [...listeners]) listener()

  assert.equal(await ready, true)
  assert.equal(listeners.size, 0)
})

test('service worker registration fails with a bounded timeout', async () => {
  const controller = new PlaygroundController({
    serviceWorkerRegistrationTimeoutMs: 10,
    registrationSetTimeoutFn: callback => {
      callback()
      return 1
    },
    registrationClearTimeoutFn() {},
  })

  await assert.rejects(
    controller.withRegistrationTimeout(new Promise(() => {})),
    /registration timed out/,
  )
})

test('an active registration can boot a hard-reloaded uncontrolled page', () => {
  const active = { scriptURL: 'http://localhost:5173/sw.js?build=test' }
  const controller = new PlaygroundController({
    location: { href: 'http://localhost:5173/' },
  })

  assert.equal(
    controller.expectedServiceWorker({ controller: null }, { active }),
    active,
  )
})

test('repeated name collisions still allocate isolated storage identities', () => {
  const storage = memoryStorage()
  const ids = Array.from({ length: 15 }, () => createInstanceSession({ storage, random: () => 0 }).id)
  assert.equal(new Set(ids).size, ids.length)
})

test('disposing during registration cancels startup and readiness without creating a worker', async () => {
  let completeRegistration
  let workers = 0
  const listeners = new Set()
  const controller = new PlaygroundController({
    session: { id: 'test', freshSession: true },
    navigator: { serviceWorker: {
      controller: null,
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
      register: () => new Promise(resolve => { completeRegistration = resolve }),
    } },
    WorkerClass: class { constructor() { workers++ } },
  })
  const start = controller.start()
  assert.equal(controller.start(), start)
  const stopped = assert.rejects(start, { name: 'AbortError' })
  const ready = assert.rejects(controller.waitUntilReady(), { name: 'AbortError' })
  controller.dispose()
  completeRegistration({ active: { postMessage() {} } })
  await Promise.all([stopped, ready])
  assert.equal(workers, 0)
  assert.equal(listeners.size, 0)
})

test('disposing during activation removes the waiting listener', async () => {
  const listeners = new Set()
  const serviceWorker = {
    controller: { scriptURL: 'http://localhost/sw.js' },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    register: async () => ({}),
  }
  const controller = new PlaygroundController({ navigator: { serviceWorker },
    location: { href: 'http://localhost/' }, session: { id: 'test' },
  })
  const stopped = assert.rejects(controller.start(), { name: 'AbortError' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(listeners.size, 2)
  controller.dispose()
  await stopped
  assert.equal(listeners.size, 0)
})

test('catalog loads are shared and a failed load can be retried', async () => {
  const { useAppManager } = await import('../../packages/client/src/composables/use-app-manager.js')
  let attempts = 0
  const manager = useAppManager(() => null, { loadCatalog: async () => {
    if (++attempts === 1) throw new Error('offline')
    return { apps: [{ id: 'wiki' }] }
  } })
  const first = manager.ensureCatalog()
  assert.equal(manager.ensureCatalog(), first)
  await assert.rejects(first, /offline/)
  await manager.ensureCatalog()
  assert.equal(attempts, 2)
  assert.deepEqual(manager.availableApps.value, [{ id: 'wiki' }])
  assert.equal(manager.appCatalogLoading.value, false)
})

test('app operations await view refresh only after success', async () => {
  const { useAppManager } = await import('../../packages/client/src/composables/use-app-manager.js')
  for (const action of ['installApp', 'uninstallApp']) {
    let refresh
    let calls = 0
    let completed = false
    const runtime = {
      [action]: async () => { calls++ },
      listInstalledApps: () => action === 'installApp' ? ['wiki'] : [],
    }
    const manager = useAppManager(() => runtime, {
      refreshView: () => new Promise(resolve => { refresh = resolve }),
    })
    const pending = manager[action]('wiki').then(() => { completed = true })
    await Promise.resolve()
    assert.deepEqual(manager.installedApps.value, runtime.listInstalledApps())
    await manager[action]('wiki')
    assert.equal(calls, 1)
    assert.equal(completed, false)
    refresh()
    await pending
    assert.equal(manager.installingAppId.value || manager.uninstallingAppId.value, '')

    runtime[action] = async () => { throw new Error('mutation failed') }
    refresh = null
    await manager[action]('wiki')
    assert.equal(manager.appInstallError.value, 'mutation failed')
    assert.equal(refresh, null)
  }
})

test('an old app operation cannot clear the next instance operation or refresh its view', async () => {
  const { useAppManager } = await import('../../packages/client/src/composables/use-app-manager.js')
  let finishOld
  let finishNew
  let refreshes = 0
  const old = { installApp: () => new Promise(resolve => { finishOld = resolve }), listInstalledApps: () => ['wiki'] }
  const next = { installApp: () => new Promise(resolve => { finishNew = resolve }), listInstalledApps: () => ['crm'] }
  let active = old
  const manager = useAppManager(() => active, { refreshView: () => refreshes++ })
  const first = manager.installApp('wiki')
  active = next
  manager.resetAppState()
  const second = manager.installApp('crm')
  finishOld()
  await first
  assert.equal(manager.installingAppId.value, 'crm')
  assert.equal(refreshes, 0)
  finishNew()
  await second
  assert.equal(manager.installingAppId.value, '')
  assert.equal(refreshes, 1)
})

test('a synchronous startup failure does not cache a rejected promise across retries', async () => {
  const controller = new PlaygroundController({ navigator: {} })
  const first = controller.start()
  await assert.rejects(first, /Service workers are unavailable/)
  const second = controller.start()
  await assert.rejects(second, /Service workers are unavailable/)
  assert.notEqual(second, first)
})

test('boot app installation does not wait for the optional dialog catalog', async () => {
  const { useAppManager } = await import('../../packages/client/src/composables/use-app-manager.js')
  let completeCatalog
  const catalog = new Promise(resolve => { completeCatalog = resolve })
  let installs = 0
  let catalogLoads = 0
  const runtime = { installApp: async () => { installs++ } }
  const manager = useAppManager(() => runtime, { loadCatalog: () => {
    catalogLoads++
    return catalog
  } })
  const installing = manager.installBootApp('wiki', runtime)
  try {
    await Promise.resolve()
    assert.equal(installs, 1)
    assert.equal(catalogLoads, 0)
  } finally {
    completeCatalog({ apps: [] })
    await installing
  }
})
