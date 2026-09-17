import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  FRAPPE_MOCKS_SOURCE,
  WSGI_SERVER_SOURCE,
} from '../../artifacts/generated/python-sources.js'
import { ensureDirectories } from '../../packages/server/src/filesystem.js'
import {
  PythonBridge,
  SerialRequestExecutor,
  shouldPersistRequest,
} from '../../packages/server/src/request-handler.js'
import { initializePyodide } from '../../packages/server/src/boot.js'
import {
  appById,
  installCatalogApp,
  prepareInstalledApps,
  uninstallCatalogApp,
} from '../../packages/server/src/app-installer.js'
import {
  BrowserStateStore,
  restoreSiteFiles,
  snapshotSiteFiles,
} from '../../packages/server/src/persistence.js'

function memoryIndexedDb() {
  const values = new Map()
  const request = result => {
    const operation = {}
    queueMicrotask(() => {
      operation.result = result
      operation.onsuccess?.()
    })
    return operation
  }
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    transaction(_name, mode) {
      const transaction = {
        objectStore: () => ({
          get: key => request(values.get(key)),
          clear: () => values.clear(),
          put: (value, key) => values.set(key, value),
        }),
      }
      queueMicrotask(() => transaction.oncomplete?.())
      return transaction
    },
    close() {},
  }
  return {
    open() {
      return request(database)
    },
  }
}

test('generated Python text module exactly matches authored Python sources', async () => {
  const [mocks, wsgi] = await Promise.all([
    readFile(new URL('../../runtime/python/frappe_mocks.py', import.meta.url), 'utf8'),
    readFile(new URL('../../runtime/python/wsgi_server.py', import.meta.url), 'utf8'),
  ])
  assert.equal(FRAPPE_MOCKS_SOURCE, mocks)
  assert.equal(WSGI_SERVER_SOURCE, wsgi)
  assert.match(mocks, /create_mock\(\s*"resource"/)
  assert.match(mocks, /RUSAGE_SELF=0/)
  assert.match(mocks, /ru_maxrss = 0/)
  assert.match(mocks, /threading\.Timer = DummyTimer/)
})

test('source-only Python packages are bundled instead of sent to micropip', async () => {
  const [packagesSource, dockerfile] = await Promise.all([
    readFile(new URL('../../runtime/config/packages.js', import.meta.url), 'utf8'),
    readFile(new URL('../../runtime/build/Dockerfile', import.meta.url), 'utf8'),
  ])

  assert.doesNotMatch(packagesSource, /['"]pyqrcode['"]/i)
  assert.match(dockerfile, /PyQRCode==1\.2\.1/)
})

test('runtime directory creation tolerates existing directories', () => {
  const created = []
  const fs = {
    mkdir(path) {
      if (path === '/exists') throw new Error('already exists')
      created.push(path)
    },
  }
  ensureDirectories(fs, ['/exists', '/new'])
  assert.deepEqual(created, ['/new'])
})

test('uploaded site files are snapshotted and restored within allowed roots', () => {
  const createFs = () => {
    const directories = new Set(['/site', '/site/public', '/site/public/files', '/site/private', '/site/private/files'])
    const files = new Map()
    return {
      directories,
      files,
      readdir(directory) {
        const prefix = `${directory}/`
        const children = new Set(['.', '..'])
        for (const path of [...directories, ...files.keys()]) {
          if (path.startsWith(prefix)) children.add(path.slice(prefix.length).split('/')[0])
        }
        return [...children]
      },
      stat(path) {
        return { mode: directories.has(path) ? 1 : 2 }
      },
      isDir: mode => mode === 1,
      isFile: mode => mode === 2,
      readFile: path => files.get(path),
      writeFile: (path, data) => files.set(path, new Uint8Array(data)),
      mkdir: path => directories.add(path),
    }
  }

  const source = createFs()
  source.files.set('/site/public/files/image.png', new Uint8Array([1, 2, 3]))
  source.directories.add('/site/private/files/nested')
  source.files.set('/site/private/files/nested/document.txt', new Uint8Array([4, 5]))
  const roots = ['/site/public/files', '/site/private/files']
  const snapshot = snapshotSiteFiles(source, roots)

  const restored = createFs()
  restoreSiteFiles(restored, snapshot, roots)
  assert.deepEqual(restored.files.get('/site/public/files/image.png'), new Uint8Array([1, 2, 3]))
  assert.deepEqual(
    restored.files.get('/site/private/files/nested/document.txt'),
    new Uint8Array([4, 5]),
  )
})

test('installed app metadata is persisted with its playground database', async () => {
  const indexedDB = memoryIndexedDb()
  const sourceFiles = new Map([['/site.db', new Uint8Array([1, 2, 3])]])
  const source = new BrowserStateStore({
    indexedDB,
    scope: 'instance-1',
    getFs: () => ({ readFile: path => sourceFiles.get(path) }),
  })
  await source.preloadedState
  source.installedApps = ['wiki']
  await source.save('/site.db')

  const restoredFiles = new Map()
  const restored = new BrowserStateStore({
    indexedDB,
    scope: 'instance-1',
    getFs: () => ({ writeFile: (path, value) => restoredFiles.set(path, value) }),
  })
  assert.deepEqual(await restored.load('/restored.db'), { status: 'restored' })
  assert.deepEqual(restored.installedApps, ['wiki'])
  assert.deepEqual(restoredFiles.get('/restored.db'), new Uint8Array([1, 2, 3]))
})

test('Pyodide loader installs core and configured Python packages', async () => {
  const calls = []
  const pyodide = {
    runPythonAsync: async source => calls.push(['python', source]),
    loadPackage: async packages => calls.push(['core', packages]),
    pyimport: name => ({
      install: async (packages, options) => calls.push(['install', name, packages, options]),
    }),
  }
  const globalScope = {
    loadPyodide: async options => {
      calls.push(['load', options])
      return pyodide
    },
  }
  const logs = []
  assert.equal(await initializePyodide({
    globalScope,
    fetchFn: async () => { throw new Error('loader should already be available') },
    pythonPackages: ['requests'],
    log: message => logs.push(message),
    baseUrl: 'https://cdn.test/pyodide/',
  }), pyodide)
  assert.deepEqual(logs, [
    'Loading Pyodide...',
    'Loading core packages...',
    'Installing Python dependencies...',
  ])
  assert.deepEqual(calls.find(call => call[0] === 'core')[1], [
    'micropip',
    'cryptography',
    'tzdata',
  ])
  assert.deepEqual(calls.find(call => call[0] === 'install')[2], ['requests'])

  // Execute the actual boot filter: compile-time warnings use filenames,
  // whereas warnings raised at runtime may have a dotted module name.
  const warningCheck = spawnSync('python3', ['-'], { encoding: 'utf8', input:
    'import warnings\nwarnings.simplefilter("always")\n'
    + calls.find(call => call[0] === 'python')[1] + String.raw`
whoosh_path = "/lib/python3.14/site-packages/whoosh/analysis/filters.py"
for filename, expected in [(whoosh_path, 0), ("/app/example.py", 1)]:
    with warnings.catch_warnings(record=True) as seen:
        compile('value = "\\w"', filename, 'exec')
        assert len(seen) == expected, (filename, seen)
for message, category, module, expected in [
    ('"\\w" is an invalid escape sequence', SyntaxWarning, 'whoosh.analysis', 0),
    ('unrelated warning', SyntaxWarning, 'whoosh.analysis', 1),
    ('invalid escape sequence', UserWarning, 'whoosh.analysis', 1),
    ('invalid escape sequence', SyntaxWarning, 'whoosh_other.analysis', 1),
]:
    with warnings.catch_warnings(record=True) as seen:
        warnings.warn_explicit(message, category, whoosh_path, 1, module=module)
        assert len(seen) == expected, (message, module, seen)
` })
  assert.equal(warningCheck.status, 0, warningCheck.stderr)
})

test('catalog apps are verified, unpacked, and installed into the scoped site', async () => {
  const archive = new TextEncoder().encode('app archive')
  const digest = await crypto.subtle.digest('SHA-256', archive)
  const archiveSha256 = [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
  const app = {
    id: 'wiki',
    archive: 'apps/wiki/app.zip',
    archiveBytes: archive.byteLength,
    archiveSha256,
    pythonDependencies: ['mistune>=3.0'],
  }
  const writes = []
  const calls = []
  const pyodide = {
    FS: { writeFile: (...args) => writes.push(args) },
    globals: {
      set: (...args) => calls.push(['set', ...args]),
      delete: (...args) => calls.push(['delete', ...args]),
    },
    pyimport: name => ({
      install: async (...args) => calls.push(['install-dependencies', name, ...args]),
    }),
    unpackArchive: (...args) => calls.push(['unpack', ...args]),
    runPythonAsync: async source => calls.push(['python', source]),
  }
  const fetchFn = async url => {
    assert.equal(url, '/apps/wiki/app.zip')
    return {
      ok: true,
      arrayBuffer: async () => archive.buffer,
    }
  }

  const installed = await installCatalogApp({
    pyodide,
    fetchFn,
    catalog: { apps: [app] },
    appId: 'wiki',
    installedAppIds: [],
    environmentRoot: '/runtime',
    appsFile: '/bench/sites/apps.txt',
    cryptoApi: crypto,
  })

  assert.deepEqual(installed, ['wiki'])
  assert.deepEqual(writes.at(-1), ['/bench/sites/apps.txt', 'frappe\nwiki\n'])
  assert.deepEqual(calls.find(call => call[0] === 'install-dependencies').slice(1), [
    'micropip',
    ['mistune>=3.0'],
    { keep_going: true },
  ])
  assert.equal(calls.some(call => call[0] === 'unpack' && call[2] === 'zip'), true)
  assert.equal(calls.some(call => call[0] === 'python' && call[1].includes('install_app')), true)

  await prepareInstalledApps({
    pyodide,
    fetchFn,
    catalog: { apps: [app] },
    appIds: [],
    environmentRoot: '/runtime',
    appsFile: '/bench/sites/apps.txt',
    cryptoApi: crypto,
  })
  assert.deepEqual(writes.at(-1), ['/bench/sites/apps.txt', 'frappe\n'])
  assert.throws(() => appById({ apps: [app] }, 'missing'), /not available/)

  const remaining = await uninstallCatalogApp({
    pyodide,
    catalog: { apps: [app] },
    appId: 'wiki',
    installedAppIds: ['wiki'],
    appsFile: '/bench/sites/apps.txt',
  })
  assert.deepEqual(remaining, [])
  assert.deepEqual(writes.at(-1), ['/bench/sites/apps.txt', 'frappe\n'])
  assert.equal(calls.some(call => call[0] === 'python' && call[1].includes('remove_app')), true)
})

test('Python bridge converts requests and releases PyProxy values', () => {
  const destroyed = []
  const pythonResponse = {
    toJs: () => ({ status: 200, headers: [], body: 'pong' }),
    destroy: () => destroyed.push('response'),
  }
  const pythonRequest = { destroy: () => destroyed.push('request') }
  const pyodide = {
    toPy: () => pythonRequest,
    globals: { set() {} },
    runPython: () => pythonResponse,
  }
  const bridge = new PythonBridge({ pyodide, mocksSource: '', wsgiSource: '' })
  assert.deepEqual(bridge.handleRequest({ method: 'GET', path: '/api/method/ping' }), {
    status: 200,
    headers: [],
    body: 'pong',
  })
  assert.deepEqual(destroyed, ['request', 'response'])
})

test('Python bridge restores and exports the WSGI handler cookie jar', async () => {
  const scripts = []
  const pyodide = {
    globals: { set() {} },
    runPythonAsync: async script => {
      scripts.push(script)
      return '{"sid":"session-id"}'
    },
  }
  const bridge = new PythonBridge({
    pyodide,
    mocksSource: 'mocks',
    wsgiSource: 'wsgi',
    cookieJarJson: '{"sid":"session-id"}',
  })

  await bridge.configure()
  assert.match(scripts.at(-1), /_handler\.cookie_jar = json\.loads/)
  assert.equal(await bridge.exportCookieJar(), '{"sid":"session-id"}')
  assert.match(scripts.at(-1), /json\.dumps\(_handler\.cookie_jar\)/)
})

test('request persistence policy covers mutations and session cookies', () => {
  assert.equal(shouldPersistRequest({ method: 'POST' }, { headers: [] }), true)
  assert.equal(shouldPersistRequest({ method: 'GET' }, { headers: [] }), false)
  assert.equal(
    shouldPersistRequest({ method: 'GET' }, { headers: [['Set-Cookie', 'sid=1']] }),
    true,
  )
})

test('serial executor responds through the request MessagePort and persists mutations', async () => {
  const responses = []
  let persisted = 0
  const executor = new SerialRequestExecutor({
    decodeRequest: value => value,
    encodeResponse: value => value,
    encodeError: error => ({ status: 500, body: error.message }),
    handleRequest: async () => ({ status: 200, headers: [], body: 'ok' }),
    persist: async () => { persisted += 1 },
    schedule: callback => callback(),
    logger: { log() {} },
  })
  const port = {}
  executor.attach(port)
  port.onmessage({
    data: { method: 'POST', path: '/login' },
    ports: [{ postMessage: value => responses.push(value) }],
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(persisted, 1)
  assert.deepEqual(responses, [{ status: 200, headers: [], body: 'ok' }])
})

test('runtime queue serializes mutations with saves across channel replacement and survives errors', async () => {
  let finishSave
  const saving = new Promise(resolve => { finishSave = resolve })
  const events = []
  const executor = new SerialRequestExecutor({
    decodeRequest: value => value, encodeResponse: value => value,
    encodeError: error => ({ status: 500, body: error.message }),
    handleRequest: async () => { events.push('request'); return { status: 200, headers: [] } },
    persist: async () => { events.push('saving'); await saving; events.push('saved') },
    schedule: callback => callback(), logger: { log() {} },
  })
  const oldPort = { close() { events.push('closed') } }
  executor.attach(oldPort)
  const request = oldPort.onmessage({ data: { method: 'POST' }, ports: [{ postMessage() {} }] })
  await Promise.resolve()
  executor.attach({})
  const mutation = executor.enqueue(() => { events.push('mutation'); throw new Error('install failed') })
  const failed = assert.rejects(mutation, /install failed/)
  const next = executor.enqueue(() => events.push('next'))
  assert.deepEqual(events, ['request', 'saving', 'closed'])
  finishSave()
  await Promise.all([request, failed, next])
  assert.deepEqual(events, ['request', 'saving', 'closed', 'saved', 'mutation', 'next'])
  assert.equal(oldPort.onmessage, null)
})

test('failed Python execution releases its request proxy and global reference', () => {
  const cleaned = []
  const bridge = new PythonBridge({ pyodide: {
    toPy: () => ({ destroy: () => cleaned.push('proxy') }),
    globals: { set() {}, delete: name => cleaned.push(name) },
    runPython() { throw new Error('Python failed') },
  } })
  assert.throws(() => bridge.handleRequest({ method: 'GET' }), /Python failed/)
  assert.deepEqual(cleaned, ['current_req', 'proxy'])
})

test('state saves reject transaction aborts and quota errors and close the database', async () => {
  for (const error of [null, new Error('Quota exceeded')]) {
    const state = new BrowserStateStore({ indexedDB: memoryIndexedDb(), scope: 'test',
      getFs: () => ({ readFile: () => new Uint8Array([1]) }),
    })
    await state.preloadedState
    let closed = false
    state.open = async () => ({
      transaction() {
        const transaction = { error, objectStore: () => ({ put() {} }) }
        queueMicrotask(() => transaction.onabort())
        return transaction
      },
      close() { closed = true },
    })
    await assert.rejects(state.save('/site.db'), error ? /Quota exceeded/ : /aborted/)
    assert.equal(closed, true)
  }
})

test('a failed checkpoint does not remove SQLite sidecars', async () => {
  const { checkpointDatabase } = await import('../../packages/server/src/persistence.js')
  let removed = false
  await assert.rejects(checkpointDatabase({
    runPythonAsync: async () => { throw new Error('checkpoint busy') },
    FS: { unlink() { removed = true } },
  }, '/site.db'), /checkpoint busy/)
  assert.equal(removed, false)
})

test('synchronous save errors abort queued writes instead of committing partial state', async () => {
  const state = new BrowserStateStore({ indexedDB: memoryIndexedDb(), scope: 'test',
    getFs: () => ({ readFile: () => new Uint8Array([1]) }),
  })
  await state.preloadedState
  const stored = new Map([['site1.db', 'previous database']])
  let closed = false
  state.open = async () => ({
    transaction() {
      const queued = new Map()
      let aborted = false
      const transaction = {
        abort() { aborted = true; queueMicrotask(() => transaction.onabort()) },
        objectStore: () => ({ put(value, key) {
          if (key === 'cookie_jar.json') throw new DOMException('Not cloneable', 'DataCloneError')
          queued.set(key, value)
        } }),
      }
      queueMicrotask(() => {
        if (!aborted) {
          for (const [key, value] of queued) stored.set(key, value)
          transaction.oncomplete()
        }
      })
      return transaction
    },
    close() { closed = true },
  })
  await assert.rejects(state.save('/site.db'), { name: 'DataCloneError' })
  assert.equal(stored.get('site1.db'), 'previous database')
  assert.equal(closed, true)
})
