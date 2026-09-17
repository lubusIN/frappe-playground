import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { catalogFingerprint } from '../../scripts/app-catalog.mjs'
import { verifyBuild } from '../../scripts/verify-build.mjs'

test('core packaging removes only verified browser copies and translation sources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frappe-packaging-'))
  const source = path.join(root, 'source')
  const assets = path.join(root, 'assets')
  const output = path.join(root, 'runtime.tar.gz')
  const browserFiles = ['images/logo.png', 'css/fonts/font.woff2', 'sounds/click.mp3']
  const retained = ['js/frappe/utils/web_template.js', 'icons/desktop_icons/solid/test.svg',
    'scss/website.scss', 'css/email.css', 'html/editor.html']
  const write = async (name, contents) => {
    await mkdir(path.dirname(name), { recursive: true })
    await writeFile(name, contents)
  }
  const packageRuntime = () => spawnSync('python3', [
    'runtime/build/package-core-runtime.py', source, assets, output,
  ], { encoding: 'utf8' })
  try {
    for (const name of [...browserFiles, ...retained]) {
      await write(path.join(source, 'frappe/public', name), `contents:${name}`)
      await write(path.join(assets, 'frappe', name), `contents:${name}`)
    }
    const compiled = path.join(assets, 'locale/de/LC_MESSAGES/frappe.mo')
    const catalog = Buffer.alloc(28)
    catalog.writeUInt32LE(0x950412de)
    await write(compiled, catalog)
    await write(path.join(source, 'frappe/locale/de.po'), 'source')
    await write(path.join(source, 'frappe/locale/main.pot'), 'template')
    await write(path.join(source, 'frappe/__init__.py'), 'runtime')
    const result = packageRuntime()
    assert.equal(result.status, 0, result.stderr)
    const listing = spawnSync('python3', ['-c',
      'import json,sys,tarfile; t=tarfile.open(sys.argv[1]); print(json.dumps([m.name.removeprefix("./") for m in t if m.isfile()]))',
      output], { encoding: 'utf8' })
    assert.equal(listing.status, 0, listing.stderr)
    assert.deepEqual(JSON.parse(listing.stdout).sort(), [
      'frappe/__init__.py', ...retained.map(name => `frappe/public/${name}`),
    ].sort())

    await rm(output)
    await rm(compiled)
    assert.match(packageRuntime().stderr, /Missing or invalid compiled Frappe catalog: de/)
    await assert.rejects(access(output))
    await write(compiled, 'not a compiled catalog')
    assert.match(packageRuntime().stderr, /Missing or invalid compiled Frappe catalog: de/)
    await assert.rejects(access(output))
    await write(compiled, catalog.subarray(0, 4))
    assert.match(packageRuntime().stderr, /Missing or invalid compiled Frappe catalog: de/)
    await assert.rejects(access(output))
    await write(compiled, catalog)
    await write(path.join(assets, 'frappe/images/logo.png'), 'different bytes')
    const mismatch = packageRuntime()
    assert.notEqual(mismatch.status, 0)
    assert.match(mismatch.stderr, /Missing or different published Frappe asset: images\/logo.png/)
    await assert.rejects(access(output))
    await rm(path.join(assets, 'frappe/images/logo.png'))
    const missing = packageRuntime()
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /Missing or different published Frappe asset/)
    await assert.rejects(access(output))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runtime verification detects omitted, missing, and corrupt compiled catalogs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frappe-manifest-'))
  const authoredCatalogPath = path.resolve('runtime/apps/catalog.json')
  const authored = JSON.parse(await readFile(authoredCatalogPath, 'utf8'))
  const write = async (name, content) => {
    const target = path.join(root, name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  const verify = () => verifyBuild({ artifactsDir: root, authoredCatalogPath, runtimeOnly: true })
  try {
    const apps = []
    for (const app of authored.apps) {
      await write(app.archive, app.id)
      apps.push({ ...app, archiveBytes: Buffer.byteLength(app.id),
        archiveSha256: createHash('sha256').update(app.id).digest('hex') })
    }
    await write('apps/catalog.json', JSON.stringify({ ...authored, apps,
      sourceCatalogSha256: catalogFingerprint(authored) }))
    await write('frappe_runtime.tar.gz', 'archive')
    await write('site1.db', 'seed')
    await write('assets/assets.json', '{}')
    const catalog = Buffer.alloc(28)
    catalog.writeUInt32LE(0x950412de)
    const german = 'assets/locale/de/LC_MESSAGES/frappe.mo'
    const french = 'assets/locale/fr/LC_MESSAGES/frappe.mo'
    await write(german, catalog)
    await write(french, catalog)
    await write('assets/locale/app_only/LC_MESSAGES/erpnext.mo', catalog)
    const result = spawnSync(process.execPath, ['scripts/write-runtime-manifest.mjs', root, 'v16.30.0'], {
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    await verify()
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
    assert.ok(manifest.files[german])
    assert.ok(manifest.files[french])
    assert.equal(Object.keys(manifest.files).some(name => name.includes('app_only')), false)

    const original = JSON.stringify(manifest)
    delete manifest.files[german]
    await write('manifest.json', JSON.stringify(manifest))
    await assert.rejects(verify(), /Runtime manifest is missing assets\/locale\/de\/LC_MESSAGES\/frappe.mo/)
    await write('manifest.json', original)
    await rm(path.join(root, german))
    await assert.rejects(verify(), /Missing runtime artifact or publish copy: assets\/locale\/de/)
    await write(german, 'invalid compiled catalog')
    await assert.rejects(verify(), /Invalid compiled translation catalog: assets\/locale\/de/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
