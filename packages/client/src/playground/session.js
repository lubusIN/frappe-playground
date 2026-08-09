export const PLAYGROUND_SESSION_KEY = 'frappe_playground_instance_id'
export const PLAYGROUND_INSTANCES_KEY = 'frappe_playground_instances'

function createId({ cryptoApi, now, random }) {
  return cryptoApi?.randomUUID
    ? cryptoApi.randomUUID()
    : `${now()}-${random().toString(16).slice(2)}`
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
  const id = createId({ cryptoApi, now, random })
  const createdAt = now()
  const instances = parseCatalog(storage)
  const instance = {
    id,
    name: name?.trim() || `Playground ${instances.length + 1}`,
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

  // Adopt the pre-catalog session so existing playground data remains reachable.
  if (activeId) {
    const timestamp = now()
    const instance = {
      id: activeId,
      name: 'Playground 1',
      createdAt: timestamp,
      lastOpenedAt: timestamp,
    }
    saveCatalog(storage, [...parseCatalog(storage), instance])
    return { ...instance, freshSession: false }
  }

  return createInstanceSession({ storage, cryptoApi, now, random, name: options.name })
}
