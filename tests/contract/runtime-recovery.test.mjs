import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRenderer, ref } from 'vue'
import { BrowserStateStore, initializeSiteDatabase } from '../../packages/server/src/persistence.js'
import { installRuntimeFilesystem } from '../../packages/server/src/filesystem.js'
import { RuntimeAssetCache } from '../../packages/service-worker/src/cache.js'
import { createMessage, ProtocolMessageType as Type, isControlMessage, hasMessagePort } from '../../packages/protocol/src/messages.js'
import { parseBootOptions } from '../../packages/client/src/playground/boot-options.js'
import { resolveBootLocale } from '../../packages/client/src/playground/boot-locale.js'
import { deleteInstanceData } from '../../packages/client/src/playground/session.js'
import { useInstanceManager } from '../../packages/client/src/composables/use-instance-manager.js'
import { usePlaygroundLifecycle } from '../../packages/client/src/composables/use-playground-lifecycle.js'
import { replaceDirectory } from '../../scripts/transactional-directory.mjs'
import { authoredPublicFiles, resolveDevFile, projectRoot } from '../../scripts/publication.mjs'

const logger = { warn() {}, log() {}, time() {}, timeEnd() {} }

test('database read and filesystem restore failures never seed or save over stored data', async () => {
  for (const failure of ['read', 'restore']) {
    let closed = 0
    const error = new Error(`${failure} failed`)
    const database = {
      close() { closed++ },
      transaction() {
        const transaction = { objectStore: () => ({ get(key) {
          const request = {}
          queueMicrotask(() => {
            if (failure === 'read') { request.error = error; request.onerror() }
            else { request.result = key === 'site1.db' ? new Uint8Array([1]) : undefined; request.onsuccess() }
          })
          return request
        } }) }
        queueMicrotask(() => transaction.oncomplete?.())
        return transaction
      },
    }
    const store = new BrowserStateStore({
      indexedDB: { open() { const request = {}; queueMicrotask(() => { request.result = database; request.onsuccess() }); return request } },
      scope: 'saved', logger,
      getFs: () => ({ writeFile() { throw error } }),
    })
    await assert.rejects(initializeSiteDatabase({
      stateStore: store, freshSession: false, dbPath: '/site.db', logger, log() {},
      pyodide: { FS: { writeFile() { assert.fail('must not seed') } } },
      fetchFn() { assert.fail('must not fetch seed') },
    }), error)
    assert.equal(closed, 1)
  }
})

test('only an explicitly missing database is seeded and saved', async () => {
  const calls = []
  await initializeSiteDatabase({
    stateStore: { load: async () => ({ status: 'missing' }), save: async () => calls.push('save') },
    pyodide: { FS: { writeFile: () => calls.push('seed') }, runPythonAsync: async () => calls.push('setup') },
    fetchFn: async () => new Response(new Uint8Array([1])), storageEndpoint: '/storage',
    dbPath: '/site.db', logger, log() {},
  })
  assert.deepEqual(calls, ['seed', 'setup', 'save'])
})

test('cache open, lookup, write and pruning failures preserve a network response', async () => {
  for (const failure of ['open', 'match', 'put', 'keys']) {
    const operation = name => async () => { if (name === failure) throw new Error('quota'); return name === 'keys' ? [] : undefined }
    const cache = new RuntimeAssetCache({
      fetchFn: async () => new Response('asset'), logger,
      cacheStorage: { keys: operation('keys'), open: async () => {
        await operation('open')()
        return { match: operation('match'), put: operation('put') }
      } },
    })
    assert.equal(await (await cache.respond(new Request('https://test/assets/a.js'))).text(), 'asset')
  }
})

test('cache manifest initialization retries after temporary network failure', async () => {
  let failed = true
  const cache = new RuntimeAssetCache({
    fetchFn: async () => { if (failed) throw new Error('offline'); return new Response('{}') },
    cacheStorage: { keys: async () => [] }, logger,
  })
  assert.equal(await cache.getCacheName(), null)
  failed = false
  assert.match(await cache.getCacheName(), /^frappe-assets-/)
})

test('Python-only archive changes refresh the environment and remove obsolete files', async () => {
  const files = new Map([['/env/version.txt', 'a'.repeat(64)], ['/env/obsolete.py', 'old']])
  let archiveHash = 'b'.repeat(64)
  let extracts = 0
  const fs = {
    filesystems: { IDBFS: {} }, mkdir() {}, mount() {}, syncfs(_populate, callback) { callback() },
    readFile: name => files.get(name), writeFile: (name, value) => files.set(name, value),
    readdir: () => [...files.keys()].map(name => name.split('/').at(-1)),
    lstat: () => ({ mode: 0 }), isDir: () => false, unlink: name => files.delete(name),
  }
  const install = () => installRuntimeFilesystem({
    pyodide: { FS: fs, unpackArchive() { extracts++; files.set('/env/current.py', 'new') } },
    fetchFn: async url => url.includes('manifest.json')
      ? Response.json({ files: { 'frappe_runtime.tar.gz': { sha256: archiveHash } } })
      : new Response('{}'),
    assetsEndpoint: '/assets', storageEndpoint: '/storage', environmentRoot: '/env', benchDirectories: [], logger, log() {},
  })
  await install()
  assert.equal(files.has('/env/obsolete.py'), false)
  assert.equal(files.get('/env/version.txt'), archiveHash)
  await install()
  assert.equal(extracts, 1)
  archiveHash = 'c'.repeat(64)
  await install()
  assert.equal(extracts, 2)
})

test('untrusted control messages reject missing or malformed fields and ports', () => {
  for (const type of [Type.INIT_CHANNEL, Type.RUNTIME_LOG, Type.RUNTIME_ERROR, Type.APP_INSTALL, Type.APP_INSTALL_RESULT]) {
    assert.equal(isControlMessage(createMessage(type)), false)
    assert.equal(isControlMessage(createMessage(type, [])), false)
  }
  assert.equal(isControlMessage(createMessage(Type.RUNTIME_READY)), true)
  assert.equal(isControlMessage(createMessage(Type.RUNTIME_READY, { installedApps: [12] })), false)
  assert.equal(isControlMessage(createMessage(Type.APP_INSTALL_RESULT, { appId: 'wiki', requestId: '1', installed: 'yes' })), false)
  assert.equal(hasMessagePort({ ports: [{}] }), false)
  assert.equal(hasMessagePort({ ports: [{ postMessage() {}, close() {} }] }), true)
})

test('boot options normalize app lists and preserve onboarding and landing behavior', () => {
  const options = parseBootOptions(new URLSearchParams('apps=wiki,crm,wiki&onboarding=0&path=/blank&name=Demo'))
  assert.deepEqual(options, { name: 'Demo', createInstance: true, apps: ['wiki', 'crm'], autoLogin: true, skipOnboarding: true, initialPath: '/' })
})

test('optional geolocation has a deadline, browser fallback, and preserves boot cancellation', async () => {
  const fetchFn = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const locale = await resolveBootLocale({ fetchFn, timeoutMs: 5, languageTag: 'en-IN', storage: {} })
  assert.equal(locale.country, 'India')
  const controller = new AbortController()
  const resolving = resolveBootLocale({ fetchFn, signal: controller.signal, storage: {} })
  controller.abort()
  await assert.rejects(resolving, { name: 'AbortError' })
})

test('blocked deletion stays pending until IndexedDB confirms completion', async () => {
  const request = {}
  let blocked = false
  let complete = false
  const pending = deleteInstanceData('saved', {
    indexedDB: { deleteDatabase: () => request }, onBlocked: () => { blocked = true },
  }).then(() => { complete = true })
  request.onblocked()
  await Promise.resolve()
  assert.equal(blocked, true)
  assert.equal(complete, false)
  request.onsuccess()
  await pending
  assert.equal(complete, true)
})

test('late runtime failure clears readiness and disposes the failed worker', async () => {
  const oldWindow = globalThis.window
  globalThis.window = { location: { search: '', pathname: '/' }, addEventListener() {}, removeEventListener() {} }
  const listeners = new Map()
  const runtime = {
    disposed: false, abortController: new AbortController(),
    on(type, callback) { listeners.set(type, callback) },
    start: async () => ({ id: 'saved' }), waitUntilReady: async () => {},
    listInstalledApps: () => [], dispose() { this.disposed = true },
  }
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  let lifecycle
  const app = renderer.createApp({ setup() {
    lifecycle = usePlaygroundLifecycle({ createRuntime: () => runtime, listSessions: () => [], processFlags: async () => ({ initialPath: '/' }) })
    return () => null
  } })
  try {
    app.mount({})
    await lifecycle.initPlayground()
    assert.equal(lifecycle.ready.value, true)
    listeners.get('error')({ error: new Error('Worker crashed') })
    assert.equal(lifecycle.runtimeState.value, 'failed')
    assert.equal(lifecycle.ready.value, false)
    assert.equal(lifecycle.bootError.value, 'Worker crashed')
    assert.equal(runtime.disposed, true)
  } finally { app.unmount(); globalThis.window = oldWindow }
})

test('runtime build failure preserves previous artifacts; successful build replaces them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-transaction-'))
  const destination = path.join(root, 'runtime')
  try {
    await mkdir(destination)
    await writeFile(path.join(destination, 'old'), 'usable')
    await assert.rejects(replaceDirectory(destination, async staged => {
      await mkdir(staged)
      throw new Error('build failed')
    }), /build failed/)
    assert.equal(await readFile(path.join(destination, 'old'), 'utf8'), 'usable')
    // Promotion itself fails if a build does not produce its staged directory.
    await assert.rejects(replaceDirectory(destination, async () => {}), /ENOENT/)
    assert.equal(await readFile(path.join(destination, 'old'), 'utf8'), 'usable')
    await replaceDirectory(destination, async staged => {
      await mkdir(staged)
      await writeFile(path.join(staged, 'new'), 'verified')
    })
    assert.deepEqual(await readdir(destination), ['new'])
    assert.deepEqual(await readdir(root), ['runtime'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('every published authored module resolves to the same source in development', () => {
  for (const [url, source] of authoredPublicFiles()) assert.equal(resolveDevFile(`/${url}`), path.join(projectRoot, source))
  assert.equal(resolveDevFile('/storage/%2e%2e/private'), null)
  assert.equal(resolveDevFile('/storage/%invalid'), null)
})

test('a read transaction abort is a failure even when all requested keys are missing', async () => {
  let closed = false
  const database = {
    close() { closed = true },
    transaction() {
      const transaction = {
        objectStore: () => ({ get() {
          const request = {}
          queueMicrotask(() => request.onsuccess())
          return request
        } }),
      }
      queueMicrotask(() => transaction.onabort())
      return transaction
    },
  }
  const store = new BrowserStateStore({
    indexedDB: { open() { const request = {}; queueMicrotask(() => { request.result = database; request.onsuccess() }); return request } },
    scope: 'saved', logger, getFs: () => assert.fail('must not restore'),
  })
  const result = await store.load('/site.db')
  assert.equal(result.status, 'failed')
  assert.match(result.error.message, /aborted/)
  assert.equal(closed, true)
})


test('failed active deletion keeps its catalog entry and exposes a recoverable failure', async () => {
  const oldWindow = globalThis.window
  const oldIndexedDB = globalThis.indexedDB
  globalThis.window = { location: { search: '' } }
  const failure = new Error('Storage unavailable')
  globalThis.indexedDB = { deleteDatabase() {
    const request = {}
    queueMicrotask(() => { request.error = failure; request.onerror() })
    return request
  } }
  const instances = ref([{ id: 'saved', name: 'Saved' }])
  let stopped = 0
  let reported
  let manager
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() {
    manager = useInstanceManager({
      instanceId: ref('saved'), instances, initPlayground() {},
      stopPlayground() { stopped++ }, failPlayground(error) { reported = error },
    })
    return () => null
  } })
  try {
    app.mount({})
    await manager.deleteInstance('saved')
    assert.equal(stopped, 1)
    assert.equal(reported, failure)
    assert.equal(manager.instanceBusy.value, false)
    assert.equal(manager.instanceError.value, failure.message)
    assert.equal(instances.value[0].id, 'saved')
  } finally {
    app.unmount()
    globalThis.window = oldWindow
    globalThis.indexedDB = oldIndexedDB
  }
})
