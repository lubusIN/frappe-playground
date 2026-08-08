export class InstanceRegistry {
  constructor() {
    this.instances = new Map()
    this.clientScopes = new Map()
  }

  get size() {
    return this.instances.size
  }

  register(scope, port, clientId) {
    const instance = { port, ready: false, clientId }
    this.instances.set(scope, instance)
    if (clientId) this.clientScopes.set(clientId, scope)
    return instance
  }

  get(scope) {
    if (!scope) return null
    return this.instances.get(scope) || null
  }

  clearExcept(keepScope) {
    const cleared = []
    for (const scope of this.instances.keys()) {
      if (scope !== keepScope) {
        this.instances.delete(scope)
        cleared.push(scope)
      }
    }
    for (const [clientId, scope] of this.clientScopes) {
      if (scope !== keepScope) this.clientScopes.delete(clientId)
    }
    return cleared
  }

  associateClient(clientId, scope) {
    if (clientId && scope) this.clientScopes.set(clientId, scope)
  }

  scopeForClient(clientId) {
    return clientId ? this.clientScopes.get(clientId) || null : null
  }

  onlyActiveScope() {
    return this.instances.size === 1 ? this.instances.keys().next().value : null
  }

  async waitUntilAvailable({
    timeoutMs = 5000,
    pollMs = 100,
    now = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  } = {}) {
    if (this.size > 0) return true

    const deadline = now() + timeoutMs
    while (now() < deadline) {
      if (this.size > 0) return true
      await sleep(pollMs)
    }
    return false
  }

  async waitUntilReady(scope, {
    timeoutMs = 90000,
    pollMs = 100,
    now = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  } = {}) {
    let instance = this.get(scope)
    if (instance?.ready) return true

    const deadline = now() + timeoutMs
    while (now() < deadline) {
      instance = this.get(scope)
      if (instance?.ready) return true
      await sleep(pollMs)
    }
    return false
  }
}
