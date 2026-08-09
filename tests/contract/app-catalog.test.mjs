import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { validateAppCatalog } from '../../scripts/app-catalog.mjs'

test('authored app catalog contains pinned and isolated artifacts', async () => {
  const catalog = JSON.parse(await readFile(
    new URL('../../runtime/apps/catalog.json', import.meta.url),
    'utf8',
  ))

  assert.equal(validateAppCatalog(catalog), catalog)
  assert.equal(catalog.apps[0].id, 'wiki')
  assert.match(catalog.apps[0].source.ref, /^[a-f0-9]{40}$/)
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
