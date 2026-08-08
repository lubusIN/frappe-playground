function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
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
