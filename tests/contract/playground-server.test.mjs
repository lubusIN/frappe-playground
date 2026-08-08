import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  FRAPPE_MOCKS_SOURCE,
  WSGI_SERVER_SOURCE,
} from '../../artifacts/generated/python-sources.js'
import { ensureDirectories, hashString } from '../../playground-server/src/filesystem.js'
import { PythonBridge } from '../../playground-server/src/python-bridge.js'
import {
  SerialRequestExecutor,
  shouldPersistRequest,
} from '../../playground-server/src/request-executor.js'
import { initializePyodide } from '../../playground-server/src/runtime-loader.js'

test('generated Python text module exactly matches authored Python sources', async () => {
  const [mocks, wsgi] = await Promise.all([
    readFile(new URL('../../runtime/python/frappe_mocks.py', import.meta.url), 'utf8'),
    readFile(new URL('../../runtime/python/wsgi_server.py', import.meta.url), 'utf8'),
  ])
  assert.equal(FRAPPE_MOCKS_SOURCE, mocks)
  assert.equal(WSGI_SERVER_SOURCE, wsgi)
})

test('runtime filesystem utilities are deterministic and tolerate existing directories', () => {
  const created = []
  const fs = {
    mkdir(path) {
      if (path === '/exists') throw new Error('already exists')
      created.push(path)
    },
  }
  ensureDirectories(fs, ['/exists', '/new'])
  assert.deepEqual(created, ['/new'])
  assert.equal(hashString('runtime-manifest'), hashString('runtime-manifest'))
  assert.notEqual(hashString('runtime-manifest'), hashString('other-manifest'))
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
