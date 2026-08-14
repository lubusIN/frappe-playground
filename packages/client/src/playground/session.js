export const PLAYGROUND_SESSION_KEY = 'frappe_playground_instance_id'
export const PLAYGROUND_INSTANCES_KEY = 'frappe_playground_instances'

import { ADJECTIVES, NOUNS } from './names.js'

function createId({ random }) {
  const adj = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(random() * NOUNS.length)]
  return `${adj}-${noun}`
}

function parseCatalog(storage) {
  try {
    const value = JSON.parse(storage.getItem(PLAYGROUND_INSTANCES_KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter(instance => (
      instance
      && typeof instance.id === 'string'
      && instance.id.length > 0
    ))
  } catch (_) {
    return []
  }
}

function saveCatalog(storage, instances) {
  storage.setItem(PLAYGROUND_INSTANCES_KEY, JSON.stringify(instances))
}

export function listInstanceSessions({ storage = globalThis.localStorage } = {}) {
  return parseCatalog(storage)
}

export function createInstanceSession({
  storage = globalThis.localStorage,
  cryptoApi = globalThis.crypto,
  now = Date.now,
  random = Math.random,
  name,
} = {}) {
  const instances = parseCatalog(storage)
  let id
  let attempts = 0
  do {
    id = createId({ random })
    attempts++
  } while (instances.some(i => i.id === id) && attempts < 10)

  const createdAt = now()
  const instance = {
    id,
    name: name?.trim() || (instances.length === 0 ? 'My Playground' : `Playground ${instances.length + 1}`),
    createdAt,
    lastOpenedAt: createdAt,
  }

  saveCatalog(storage, [...instances, instance])
  storage.setItem(PLAYGROUND_SESSION_KEY, id)
  return { ...instance, freshSession: true }
}

export function selectInstanceSession(id, {
  storage = globalThis.localStorage,
  now = Date.now,
} = {}) {
  const instances = parseCatalog(storage)
  const index = instances.findIndex(instance => instance.id === id)
  if (index === -1) return null

  const instance = { ...instances[index], lastOpenedAt: now() }
  instances[index] = instance
  saveCatalog(storage, instances)
  storage.setItem(PLAYGROUND_SESSION_KEY, id)
  return { ...instance, freshSession: false }
}

export function removeInstanceSession(id, { storage = globalThis.localStorage } = {}) {
  const instances = parseCatalog(storage).filter(instance => instance.id !== id)
  saveCatalog(storage, instances)
  if (storage.getItem(PLAYGROUND_SESSION_KEY) === id) {
    if (instances.length > 0) {
      const lastOpened = instances.reduce((latest, current) =>
        (current.lastOpenedAt || 0) > (latest.lastOpenedAt || 0) ? current : latest
      )
      storage.setItem(PLAYGROUND_SESSION_KEY, lastOpened.id)
    } else {
      storage.removeItem(PLAYGROUND_SESSION_KEY)
    }
  }
  return instances
}

export function renameInstanceSession(id, name, { storage = globalThis.localStorage } = {}) {
  const normalizedName = name?.trim()
  if (!normalizedName) throw new TypeError('Playground name is required')

  const instances = parseCatalog(storage)
  const index = instances.findIndex(instance => instance.id === id)
  if (index === -1) return null

  instances[index] = { ...instances[index], name: normalizedName }
  saveCatalog(storage, instances)
  return instances[index]
}

export function deleteInstanceData(id, { indexedDB = globalThis.indexedDB } = {}) {
  if (!indexedDB) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(`frappe_playground_db_${id}`)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Close the playground before deleting its data.'))
  })
}

export function getOrCreateInstanceSession(options = {}) {
  const {
    storage = globalThis.localStorage,
    cryptoApi = globalThis.crypto,
    now = Date.now,
    random = Math.random,
  } = options

  const activeId = storage.getItem(PLAYGROUND_SESSION_KEY)
  const selected = activeId && selectInstanceSession(activeId, { storage, now })
  if (selected) return selected

  const instances = parseCatalog(storage)
  if (instances.length > 0) {
    const lastOpened = instances.reduce((latest, current) =>
      (current.lastOpenedAt || 0) > (latest.lastOpenedAt || 0) ? current : latest
    )
    return selectInstanceSession(lastOpened.id, { storage, now })
  }

  // Adopt the pre-catalog session so existing playground data remains reachable.
  if (activeId) {
    const timestamp = now()
    const instance = {
      id: activeId,
      name: 'My Playground',
      createdAt: timestamp,
      lastOpenedAt: timestamp,
    }
    saveCatalog(storage, [instance])
    return { ...instance, freshSession: false }
  }

  return createInstanceSession({ storage, cryptoApi, now, random, name: options.name })
}
