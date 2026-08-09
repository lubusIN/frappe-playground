const APP_ID = /^[a-z][a-z0-9_]*$/
const COMMIT = /^[a-f0-9]{40}$/
const ARCHIVE = /^apps\/([a-z][a-z0-9_]*)\/app\.zip$/

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
}

export function validateAppId(appId) {
  if (typeof appId !== 'string' || !APP_ID.test(appId)) {
    throw new TypeError('appId is invalid')
  }
  return appId
}

export function validateAppCatalog(catalog, { generated = false } = {}) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new TypeError('App catalog must be an object')
  }
  if (catalog.schemaVersion !== 1) throw new TypeError('App catalog schemaVersion must be 1')
  if (!Array.isArray(catalog.apps) || catalog.apps.length === 0) {
    throw new TypeError('App catalog must contain at least one app')
  }

  const ids = new Set()
  for (const [index, app] of catalog.apps.entries()) {
    const label = `apps[${index}]`
    try {
      validateAppId(app.id)
    } catch (_) {
      throw new TypeError(`${label}.id is invalid`)
    }
    if (ids.has(app.id)) throw new TypeError(`Duplicate app id: ${app.id}`)
    ids.add(app.id)

    for (const key of ['title', 'description', 'version', 'license', 'frappeVersion']) {
      requireString(app[key], `${label}.${key}`)
    }
    if (typeof app.experimental !== 'boolean') {
      throw new TypeError(`${label}.experimental must be a boolean`)
    }
    if (app.packageRoot !== app.id) {
      throw new TypeError(`${label}.packageRoot must match its id`)
    }
    if (!ARCHIVE.test(app.archive) || app.archive.split('/').includes('..')) {
      throw new TypeError(`${label}.archive must use apps/<id>/app.zip`)
    }
    if (app.archive !== `apps/${app.id}/app.zip`) {
      throw new TypeError(`${label}.archive must match its id`)
    }
    if (app.assetPrefix !== `/assets/${app.id}`) {
      throw new TypeError(`${label}.assetPrefix must match its id`)
    }
    if (!Array.isArray(app.archiveExcludes)
      || app.archiveExcludes.some(value => typeof value !== 'string'
        || !value
        || value.includes('/')
        || value === '.'
        || value === '..')) {
      throw new TypeError(`${label}.archiveExcludes must contain top-level directory names`)
    }
    if (!Array.isArray(app.pythonDependencies)
      || app.pythonDependencies.some(value => typeof value !== 'string' || !value)) {
      throw new TypeError(`${label}.pythonDependencies must be an array of strings`)
    }
    requireString(app.source?.repository, `${label}.source.repository`)
    try {
      const repository = new URL(app.source.repository)
      if (repository.protocol !== 'https:') throw new Error()
    } catch (_) {
      throw new TypeError(`${label}.source.repository must be an HTTPS URL`)
    }
    if (!COMMIT.test(app.source?.ref || '')) {
      throw new TypeError(`${label}.source.ref must be a pinned 40-character commit`)
    }

    if (generated) {
      if (!Number.isSafeInteger(app.archiveBytes) || app.archiveBytes <= 0) {
        throw new TypeError(`${label}.archiveBytes must be a positive integer`)
      }
      if (!/^[a-f0-9]{64}$/.test(app.archiveSha256 || '')) {
        throw new TypeError(`${label}.archiveSha256 must be a SHA-256 digest`)
      }
    }
  }

  return catalog
}
