import assert from 'node:assert/strict'
import test from 'node:test'
import { mountFrappeTranslations } from '../../packages/server/src/translations.js'
import { RuntimeAssetCache } from '../../packages/service-worker/src/cache.js'

test('only base Frappe compiled catalogs are mounted as read-only lazy files', () => {
  const mounted = []
  const directories = []
  mountFrappeTranslations({
    fs: { mkdirTree: path => directories.push(path), createLazyFile: (...args) => mounted.push(args) },
    assetsEndpoint: 'https://playground.test/assets',
    manifest: { files: {
      'assets/locale/de/LC_MESSAGES/frappe.mo': { sha256: 'a'.repeat(64) },
      'assets/locale/de/LC_MESSAGES/erpnext.mo': {},
      'assets/locale/../../escape/LC_MESSAGES/frappe.mo': {},
      'frappe/locale/de.po': {},
    } },
  })
  assert.deepEqual(directories, ['/home/pyodide/bench/sites/assets/locale/de/LC_MESSAGES'])
  assert.deepEqual(mounted, [[directories[0], 'frappe.mo',
    `https://playground.test/assets/locale/de/LC_MESSAGES/frappe.mo?sha256=${'a'.repeat(64)}`, true, false]])
})

test('lazy locale HEAD probes and range reads share a complete cached GET', async () => {
  const entries = new Map()
  const calls = []
  const cache = new RuntimeAssetCache({
    fetchFn: async request => {
      calls.push(request)
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Length': '3', 'Accept-Ranges': 'bytes' },
      })
    },
    cacheStorage: { open: async () => ({
      match: async key => entries.get(key)?.clone(),
      put: async (key, value) => entries.set(key, value),
    }) },
  })
  cache.currentCacheName = 'frappe-assets-test'
  const url = 'https://playground.test/assets/locale/de/LC_MESSAGES/frappe.mo?sha256=abc'
  const head = await cache.respond(new Request(url, { method: 'HEAD' }))
  assert.equal(await head.text(), '')
  assert.equal(head.headers.get('Content-Length'), '3')
  assert.equal(head.headers.has('Accept-Ranges'), false)
  const response = await cache.respond(new Request(url, { headers: { Range: 'bytes=0-1' } }))
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'GET')
  assert.equal(calls[0].headers.has('Range'), false)
})
