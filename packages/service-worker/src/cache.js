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
    try {
      await this.initCachePromise
      return this.currentCacheName
    } finally {
      this.initCachePromise = null
    }
  }

  async initializeCacheName() {
    try {
      const cacheBuster = this.now()
      const [assetsResponse, appCatalogResponse, runtimeResponse] = await Promise.all([
        this.fetchFn(`/assets/assets.json?t=${cacheBuster}`),
        this.fetchFn(`/apps/catalog.json?t=${cacheBuster}`),
        this.fetchFn(`/storage/manifest.json?t=${cacheBuster}`),
      ])
      if (!assetsResponse.ok || !appCatalogResponse.ok || !runtimeResponse.ok) {
        throw new Error('Runtime cache manifests are unavailable.')
      }
      const identity = [
        await assetsResponse.text(),
        await appCatalogResponse.text(),
        await runtimeResponse.text(),
      ].join('\n')
      const hash = hashString(identity)
      this.currentCacheName = `frappe-assets-${hash}`

      try {
        for (const key of await this.cacheStorage.keys()) {
          if (key.startsWith('frappe-assets-') && key !== this.currentCacheName) {
            this.logger.log(`[SW] Deleting old cache: ${key}`)
            await this.cacheStorage.delete(key)
          }
        }
      } catch (error) {
        this.logger.warn('[SW] Failed to prune old caches.', error)
      }
    } catch (error) {
      this.logger.warn('[SW] Failed to initialize the asset cache.', error)
      this.currentCacheName = null
    }
  }

  async respond(request, overrideUrl = null) {
    const url = overrideUrl || request.url
    if (['GET', 'HEAD'].includes(request.method)
      && /^\/assets\/locale\/[A-Za-z0-9_]+\/LC_MESSAGES\/frappe\.mo$/.test(new URL(url).pathname)) {
      // Emscripten lazy files probe with HEAD before reading. Cache a complete
      // GET so a HEAD or partial response cannot poison subsequent reads.
      const headers = new Headers(request.headers)
      headers.delete('Range')
      const response = await this.respondAsset(new Request(url, {
        method: 'GET', headers, credentials: request.credentials,
      }))
      const responseHeaders = new Headers(response.headers)
      responseHeaders.delete('Accept-Ranges')
      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status, statusText: response.statusText, headers: responseHeaders,
      })
    }
    return this.respondAsset(request, overrideUrl)
  }

  async respondAsset(request, overrideUrl = null) {
    let cache
    const cacheKey = overrideUrl || request.url
    try {
      const name = await this.getCacheName()
      if (name) {
        cache = await this.cacheStorage.open(name)
        const cached = await cache.match(cacheKey)
        if (cached) return cached
      }
    } catch (error) {
      this.logger.warn('[SW] Asset cache read failed.', error)
    }

    const requestOptions = {
      method: request.method,
      headers: request.headers,
      credentials: request.credentials,
    }
    const response = overrideUrl
      ? await this.fetchFn(overrideUrl, requestOptions)
      : await this.fetchFn(request)

    if (cache && (response.ok || response.type === 'opaque')) {
      try {
        await cache.put(cacheKey, response.clone())
      } catch (error) {
        this.logger.warn('[SW] Asset cache write failed.', error)
      }
    }
    return response
  }
}
