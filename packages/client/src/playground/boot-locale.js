export async function resolveBootLocale({
  signal,
  fetchFn = globalThis.fetch,
  languageTag = globalThis.navigator?.language || 'en',
  storage,
  timeoutMs = 2500,
} = {}) {
  signal?.throwIfAborted()
  const language = languageTag.split('-')[0]
  let country = 'United States'
  try {
    const region = new Intl.Locale(languageTag).region
    if (region) country = new Intl.DisplayNames(['en'], { type: 'region' }).of(region) || country
  } catch (_) {}
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  try {
    storage ??= globalThis.localStorage
    const cached = storage?.getItem('frappe_playground_country')
    if (cached) return { language, country: cached, timeZone }
  } catch (_) {}

  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn('https://get.geojs.io/v1/ip/country.json', { signal: controller.signal })
    if (response.ok) {
      const data = await response.json()
      if (typeof data.name === 'string' && data.name.trim()) {
        country = data.name
        try { storage?.setItem('frappe_playground_country', country) } catch (_) {}
      }
    }
  } catch (_) {
    // Location is optional; browser locale remains a usable fallback.
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
  signal?.throwIfAborted()
  return { language, country, timeZone }
}
