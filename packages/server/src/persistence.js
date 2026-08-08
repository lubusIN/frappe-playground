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
  constructor({ indexedDB, scope, getFs, now = Date.now, logger = console }) {
    this.indexedDB = indexedDB
    this.scope = scope
    this.getFs = getFs
    this.now = now
    this.logger = logger
    this.preloadedState = this.preload()
    this.cookieJarJson = null
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
      const [siteDb, cookieJar] = await Promise.all([
        requestToPromise(store.get('site1.db')),
        requestToPromise(store.get('cookie_jar.json')),
      ])
      db.close()
      return { siteDb, cookieJar }
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
      if (typeof state.cookieJar === 'string') this.cookieJarJson = state.cookieJar
      return true
    } catch (error) {
      this.logger.warn('[Worker] Failed to restore preloaded state:', error)
      return false
    }
  }

  async save(dbPath, cookieJarJson = '{}') {
    try {
      const data = this.getFs().readFile(dbPath).slice()
      const db = await this.open()
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('files', 'readwrite')
        const store = transaction.objectStore('files')
        store.clear()
        store.put(data, 'site1.db')
        store.put(cookieJarJson, 'cookie_jar.json')
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
