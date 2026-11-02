import { getInstanceDatabaseName } from '../../protocol/src/scope-url.js'
import { fetchBinary } from './filesystem.js'

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function joinPath(parent, child) {
  return `${parent.replace(/\/$/, '')}/${child}`
}

function ensureDirectoryTree(fs, directory) {
  const parts = directory.split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current += `/${part}`
    try {
      fs.mkdir(current)
    } catch (_) {
      // Directory already exists.
    }
  }
}

export function snapshotSiteFiles(fs, roots) {
  const files = []
  const visit = (root, directory, relativeDirectory = '') => {
    for (const name of fs.readdir(directory)) {
      if (name === '.' || name === '..') continue
      const absolutePath = joinPath(directory, name)
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name
      const mode = fs.stat(absolutePath).mode
      if (fs.isDir(mode)) {
        visit(root, absolutePath, relativePath)
      } else if (fs.isFile(mode)) {
        files.push({
          root,
          path: relativePath,
          data: fs.readFile(absolutePath).slice(),
        })
      }
    }
  }

  for (const root of roots) visit(root, root)
  return files
}

export function restoreSiteFiles(fs, files = [], allowedRoots = []) {
  for (const file of files) {
    if (!allowedRoots.includes(file.root)) continue
    if (file.path.split('/').some(part => part === '..' || part === '.')) continue
    const absolutePath = joinPath(file.root, file.path)
    ensureDirectoryTree(fs, absolutePath.slice(0, absolutePath.lastIndexOf('/')))
    fs.writeFile(absolutePath, file.data)
  }
}

export async function checkpointDatabase(pyodide, dbPath) {
  await pyodide.runPythonAsync(`import site_ops; site_ops.checkpoint_database(${JSON.stringify(dbPath)})`)
  // SQLite owns its sidecars. Never unlink a WAL that may contain live data.
}

export async function repairCompletedSiteDefaults(pyodide, dbPath) {
  await pyodide.runPythonAsync(`import site_ops; site_ops.repair_completed_site_defaults(${JSON.stringify(dbPath)})`)
}

export async function resetFreshSiteSetupState(pyodide, dbPath) {
  await pyodide.runPythonAsync(`import site_ops; site_ops.reset_fresh_site_setup_state(${JSON.stringify(dbPath)})`)
}

export async function initializeSiteDatabase({
  pyodide,
  fetchFn,
  stateStore,
  dbPath,
  storageEndpoint,
  freshSession,
  manifest,
  log,
  logger = console,
}) {
  let result = { status: 'missing' }
  if (!freshSession) {
    log('Restoring isolated database...')
    logger.time('loadStateFromIDB')
    result = await stateStore.load(dbPath)
    logger.timeEnd('loadStateFromIDB')
  }

  if (result.status === 'failed') throw result.error
  if (result.status !== 'missing' && result.status !== 'restored') {
    throw new Error('Invalid database restore outcome.')
  }

  if (result.status === 'missing') {
    log('Seeding fresh database...')
    const seedSha256 = manifest?.files?.['site1.db']?.sha256
    const dbUrl = seedSha256
      ? `${storageEndpoint}/site1.db?sha256=${seedSha256}`
      : `${storageEndpoint}/site1.db`
    pyodide.FS.writeFile(
      dbPath,
      await fetchBinary(fetchFn, dbUrl),
    )
    await resetFreshSiteSetupState(pyodide, dbPath)
    logger.time('saveInitialStateToIDB')
    await stateStore.save(dbPath)
    logger.timeEnd('saveInitialStateToIDB')
  } else {
    logger.time('repairCompletedSiteDefaults')
    await repairCompletedSiteDefaults(pyodide, dbPath)
    logger.timeEnd('repairCompletedSiteDefaults')
  }
}

export class BrowserStateStore {
  constructor({
    indexedDB,
    scope,
    getFs,
    siteFileRoots = [],
    now = Date.now,
    logger = console,
  }) {
    this.indexedDB = indexedDB
    this.scope = scope
    this.getFs = getFs
    this.siteFileRoots = siteFileRoots
    this.now = now
    this.logger = logger
    this.preloadedState = this.preload()
    this.cookieJarJson = null
    this.installedApps = []
  }

  open() {
    return new Promise((resolve, reject) => {
      const request = this.indexedDB.open(getInstanceDatabaseName(this.scope), 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('files')) {
          request.result.createObjectStore('files')
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async preload() {
    let db
    try {
      db = await this.open()
      const transaction = db.transaction('files', 'readonly')
      const completed = new Promise((resolve, reject) => {
        transaction.oncomplete = resolve
        transaction.onerror = transaction.onabort = () => reject(
          transaction.error || new Error('Reading playground state was aborted.'),
        )
      })
      const store = transaction.objectStore('files')
      const [siteDb, cookieJar, siteFiles, installedApps] = await Promise.all([
        requestToPromise(store.get('site1.db')),
        requestToPromise(store.get('cookie_jar.json')),
        requestToPromise(store.get('site_files')),
        requestToPromise(store.get('installed_apps')),
        completed,
      ])
      return siteDb === undefined
        ? { status: 'missing' }
        : { status: 'restored', siteDb, cookieJar, siteFiles, installedApps }
    } catch (error) {
      this.logger.warn('[Worker] Failed to preload state from IDB:', error)
      return { status: 'failed', error }
    } finally {
      db?.close()
    }
  }

  async load(dbPath) {
    const state = await this.preloadedState
    if (state.status !== 'restored') return state
    try {
      this.getFs().writeFile(dbPath, state.siteDb)
      restoreSiteFiles(this.getFs(), state.siteFiles, this.siteFileRoots)
      if (typeof state.cookieJar === 'string') this.cookieJarJson = state.cookieJar
      if (Array.isArray(state.installedApps)) this.installedApps = state.installedApps
      return { status: 'restored' }
    } catch (error) {
      this.logger.warn('[Worker] Failed to restore preloaded state:', error)
      return { status: 'failed', error }
    }
  }

  async save(dbPath, cookieJarJson = '{}', installedApps = this.installedApps || []) {
    const data = this.getFs().readFile(dbPath).slice()
    const siteFiles = snapshotSiteFiles(this.getFs(), this.siteFileRoots)
    const db = await this.open()
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('files', 'readwrite')
        transaction.oncomplete = resolve
        transaction.onerror = transaction.onabort = () => reject(
          transaction.error || new Error('Saving playground state was aborted.'),
        )
        try {
          const store = transaction.objectStore('files')
          store.put(data, 'site1.db')
          store.put(cookieJarJson, 'cookie_jar.json')
          store.put(siteFiles, 'site_files')
          store.put(installedApps, 'installed_apps')
          store.put(JSON.stringify({ savedAt: this.now(), scope: this.scope }), 'manifest.json')
        } catch (error) {
          // A synchronous put failure does not automatically abort earlier puts.
          reject(error)
          transaction.abort()
        }
      })
    } finally {
      db.close()
    }
  }
}
