export class InstanceRegistry {
  constructor() {
    this.instances = new Map()
    this.clientScopes = new Map()
  }

  get size() {
    return this.instances.size
  }

  register(scope, port, clientId) {
    this.instances.get(scope)?.port.close?.()
    const instance = { port, ready: false, clientId }
    this.instances.set(scope, instance)
    if (clientId) this.clientScopes.set(clientId, scope)
    return instance
  }

  retire(scope, clientId) {
    const instance = this.instances.get(scope)
    if (!instance || (clientId && instance.clientId !== clientId)) return false
    instance.port.close?.()
    this.instances.delete(scope)
    for (const [id, associatedScope] of this.clientScopes) {
      if (associatedScope === scope) this.clientScopes.delete(id)
    }
    return true
  }

  get(scope) {
    if (!scope) return null
    return this.instances.get(scope) || null
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

  async waitForOnlyActiveScope(options = {}) {
    const available = await this.waitUntilAvailable(options)
    return available ? this.onlyActiveScope() : null
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
