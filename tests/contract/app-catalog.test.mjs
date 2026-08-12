import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  assertGeneratedCatalogMatches,
  catalogFingerprint,
  validateAppCatalog,
} from '../../scripts/app-catalog.mjs'

test('authored app catalog contains pinned and isolated artifacts', async () => {
  const catalog = JSON.parse(await readFile(
    new URL('../../runtime/apps/catalog.json', import.meta.url),
    'utf8',
  ))

  assert.equal(validateAppCatalog(catalog), catalog)
  assert.deepEqual(catalog.apps.map(app => app.id), ['crm', 'wiki', 'frappe_vault'])
  for (const app of catalog.apps) assert.match(app.source.ref, /^[a-f0-9]{40}$/)
  assert.equal(catalogFingerprint(catalog), catalogFingerprint({
    apps: catalog.apps,
    schemaVersion: catalog.schemaVersion,
  }))
})

test('catalog fingerprints are deterministic and change with build inputs', () => {
  const first = { schemaVersion: 1, apps: [{ id: 'wiki', version: '1' }] }
  const reordered = { apps: [{ version: '1', id: 'wiki' }], schemaVersion: 1 }
  const changed = { schemaVersion: 1, apps: [{ id: 'wiki', version: '2' }] }

  assert.equal(catalogFingerprint(first), catalogFingerprint(reordered))
  assert.notEqual(catalogFingerprint(first), catalogFingerprint(changed))
})

test('generated app artifacts must match the current authored catalog', () => {
  const app = {
    id: 'wiki',
    title: 'Wiki',
    description: 'Wiki app',
    version: '1.0.0',
    license: 'MIT',
    experimental: true,
    frappeVersion: '>=16 <17',
    archive: 'apps/wiki/app.zip',
    assetPrefix: '/assets/wiki',
    packageRoot: 'wiki',
    archiveExcludes: ['public'],
    pythonDependencies: [],
    source: { repository: 'https://example.com/wiki.git', ref: 'a'.repeat(40) },
  }
  const authored = { schemaVersion: 1, apps: [app] }
  const generated = {
    ...authored,
    sourceCatalogSha256: catalogFingerprint(authored),
    apps: [{ ...app, archiveBytes: 10, archiveSha256: 'b'.repeat(64) }],
  }

  assert.equal(assertGeneratedCatalogMatches(authored, generated), generated)
  assert.throws(
    () => assertGeneratedCatalogMatches({ ...authored, apps: [{ ...app, version: '2.0.0' }] }, generated),
    /artifacts are stale/,
  )
})

test('app catalog rejects mutable refs and duplicate ids', () => {
  const app = {
    id: 'wiki',
    title: 'Wiki',
    description: 'Wiki app',
    version: '1.0.0',
    license: 'MIT',
    experimental: true,
    frappeVersion: '>=16 <17',
    archive: 'apps/wiki/app.zip',
    assetPrefix: '/assets/wiki',
    packageRoot: 'wiki',
    archiveExcludes: ['public'],
    pythonDependencies: [],
    source: { repository: 'https://example.com/wiki.git', ref: 'main' },
  }
  assert.throws(
    () => validateAppCatalog({ schemaVersion: 1, apps: [app] }),
    /pinned 40-character commit/,
  )
  app.source.ref = 'a'.repeat(40)
  assert.throws(
    () => validateAppCatalog({ schemaVersion: 1, apps: [app, { ...app }] }),
    /Duplicate app id/,
  )
})
