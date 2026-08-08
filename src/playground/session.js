export const PLAYGROUND_SESSION_KEY = 'frappe_playground_instance_id'

export function getOrCreateInstanceSession({
  storage = globalThis.localStorage,
  cryptoApi = globalThis.crypto,
  now = Date.now,
  random = Math.random,
} = {}) {
  let id = storage.getItem(PLAYGROUND_SESSION_KEY)
  const freshSession = !id

  if (!id) {
    id = cryptoApi?.randomUUID
      ? cryptoApi.randomUUID()
      : `${now()}-${random().toString(16).slice(2)}`
    storage.setItem(PLAYGROUND_SESSION_KEY, id)
  }

  return { id, freshSession }
}
