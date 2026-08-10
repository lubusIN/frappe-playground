export function hashString(value) {
  let hash = 5381
  for (let i = 0; i < value.length; i++) hash = (hash * 33) ^ value.charCodeAt(i)
  return (hash >>> 0).toString(16)
}

export class RuntimeAssetCache {
  constructor({ fetchFn, cacheStorage, now = Date.now, logger = console }) {
    this.fetchFn = fetchFn
    this.cacheStorage = cacheStorage
    this.now = now
    this.logger = logger
    this.currentCacheName = null
    this.initCachePromise = null
  }

  async getCacheName() {
    if (this.currentCacheName) return this.currentCacheName
    if (!this.initCachePromise) this.initCachePromise = this.initializeCacheName()
    await this.initCachePromise
    return this.currentCacheName
  }

  async initializeCacheName() {
    try {
      const cacheBuster = this.now()
      const [assetsResponse, appCatalogResponse] = await Promise.all([
        this.fetchFn(`/assets/assets.json?t=${cacheBuster}`),
        this.fetchFn(`/apps/catalog.json?t=${cacheBuster}`),
      ])
      if (!assetsResponse.ok || !appCatalogResponse.ok) {
        throw new Error('Runtime cache manifests are unavailable.')
      }
      const identity = [
        await assetsResponse.text(),
        await appCatalogResponse.text(),
      ].join('\n')
      const hash = hashString(identity)
      this.currentCacheName = `frappe-assets-${hash}`

      for (const key of await this.cacheStorage.keys()) {
        if (key.startsWith('frappe-assets-') && key !== this.currentCacheName) {
          this.logger.log(`[SW] Deleting old cache: ${key}`)
          await this.cacheStorage.delete(key)
        }
      }
    } catch (error) {
      this.logger.warn('[SW] Failed to initialize the asset cache.', error)
      this.currentCacheName = 'frappe-assets-fallback'
    }
  }

  async respond(request, overrideUrl = null) {
    const cache = await this.cacheStorage.open(await this.getCacheName())
    const cacheKey = overrideUrl || request.url
    const cached = await cache.match(cacheKey)
    if (cached) return cached

    const requestOptions = {
      method: request.method,
      headers: request.headers,
      credentials: request.credentials,
    }
    const response = overrideUrl
      ? await this.fetchFn(overrideUrl, requestOptions)
      : await this.fetchFn(request)

    if (response.ok || response.type === 'opaque') {
      await cache.put(cacheKey, response.clone())
    }
    return response
  }
}
