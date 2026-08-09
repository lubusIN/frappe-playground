import { fetchBinary } from './filesystem.js'

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function removeIfExists(fs, path) {
  try {
    if (fs.analyzePath(path).exists) fs.unlink(path)
  } catch (_) {
    // Ignore transient SQLite sidecar cleanup errors.
  }
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
  await pyodide.runPythonAsync(`
import sqlite3
try:
    conn = sqlite3.connect('${dbPath}')
    conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    conn.close()
except Exception:
    pass
  `)
  removeIfExists(pyodide.FS, `${dbPath}-wal`)
  removeIfExists(pyodide.FS, `${dbPath}-shm`)
}

export async function repairCompletedSiteDefaults(pyodide, dbPath) {
  await pyodide.runPythonAsync(`
import sqlite3
conn = sqlite3.connect('${dbPath}')
try:
    values = [row[0] for row in conn.execute(
        "select is_setup_complete from 'tabInstalled Application' where app_name in ('frappe', 'erpnext')"
    ).fetchall()]
    home_page = conn.execute(
        "select defvalue from tabDefaultValue where parent='__default' and defkey='desktop:home_page'"
    ).fetchone()
    if values and all(bool(value) for value in values) and home_page and home_page[0] == 'setup-wizard':
        conn.execute("update tabDefaultValue set defvalue='workspace' where parent='__default' and defkey='desktop:home_page'")
        conn.commit()
finally:
    conn.close()
  `)
}

export async function resetFreshSiteSetupState(pyodide, dbPath) {
  await pyodide.runPythonAsync(`
import sqlite3
conn = sqlite3.connect('${dbPath}')
try:
    conn.execute("update tabSingles set value='0' where doctype='System Settings' and field='setup_complete'")
    conn.execute("update 'tabInstalled Application' set is_setup_complete=0")
    updated = conn.execute(
        "update tabDefaultValue set defvalue='setup-wizard' where parent='__default' and defkey='desktop:home_page'"
    ).rowcount
    if not updated:
        conn.execute(
            "insert into tabDefaultValue (name, parent, defkey, defvalue) values (?, '__default', 'desktop:home_page', 'setup-wizard')",
            ('__default:desktop:home_page',),
        )
    conn.commit()
finally:
    conn.close()
  `)
}

export async function initializeSiteDatabase({
  pyodide,
  fetchFn,
  stateStore,
  dbPath,
  storageEndpoint,
  freshSession,
  log,
  logger = console,
}) {
  let restored = false
  if (!freshSession) {
    log('Restoring isolated database...')
    logger.time('loadStateFromIDB')
    restored = await stateStore.load(dbPath)
    logger.timeEnd('loadStateFromIDB')
  }

  if (freshSession || !restored) {
    log('Seeding fresh database...')
    pyodide.FS.writeFile(
      dbPath,
      await fetchBinary(fetchFn, `${storageEndpoint}/site1.db`),
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
      const request = this.indexedDB.open(`frappe_playground_db_${this.scope}`, 1)
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
    try {
      const db = await this.open()
      const store = db.transaction('files', 'readonly').objectStore('files')
      const [siteDb, cookieJar, siteFiles, installedApps] = await Promise.all([
        requestToPromise(store.get('site1.db')),
        requestToPromise(store.get('cookie_jar.json')),
        requestToPromise(store.get('site_files')),
        requestToPromise(store.get('installed_apps')),
      ])
      db.close()
      return { siteDb, cookieJar, siteFiles, installedApps }
    } catch (error) {
      this.logger.warn('[Worker] Failed to preload state from IDB:', error)
      return null
    }
  }

  async load(dbPath) {
    const state = await this.preloadedState
    if (!state?.siteDb) return false
    try {
      this.getFs().writeFile(dbPath, state.siteDb)
      restoreSiteFiles(this.getFs(), state.siteFiles, this.siteFileRoots)
      if (typeof state.cookieJar === 'string') this.cookieJarJson = state.cookieJar
      if (Array.isArray(state.installedApps)) this.installedApps = state.installedApps
      return true
    } catch (error) {
      this.logger.warn('[Worker] Failed to restore preloaded state:', error)
      return false
    }
  }

  async save(dbPath, cookieJarJson = '{}', installedApps = this.installedApps || []) {
    try {
      const data = this.getFs().readFile(dbPath).slice()
      const siteFiles = snapshotSiteFiles(this.getFs(), this.siteFileRoots)
      const db = await this.open()
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('files', 'readwrite')
        const store = transaction.objectStore('files')
        store.clear()
        store.put(data, 'site1.db')
        store.put(cookieJarJson, 'cookie_jar.json')
        store.put(siteFiles, 'site_files')
        store.put(installedApps, 'installed_apps')
        store.put(
          JSON.stringify({ savedAt: this.now(), scope: this.scope }),
          'manifest.json',
        )
        transaction.oncomplete = () => {
          db.close()
          resolve()
        }
        transaction.onerror = () => {
          db.close()
          reject(transaction.error)
        }
      })
    } catch (error) {
      this.logger.warn('[Worker] Failed to persist state to IDB:', error)
    }
  }
}
