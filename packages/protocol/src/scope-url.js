export const SCOPE_PATH_PREFIX = '/scope:'
export const LEGACY_SCOPE_QUERY_PARAM = '__scope'

export function scopeFromPath(pathname) {
  const match = String(pathname || '').match(/^\/scope:([^/]+)(?:\/|$)/)
  if (!match) return null

  try {
    return decodeURIComponent(match[1]) || null
  } catch (_) {
    return null
  }
}

export function stripScopeFromPath(pathname) {
  const value = String(pathname || '/')
  if (!scopeFromPath(value)) return value.startsWith('/') ? value : `/${value}`

  const separator = value.indexOf('/', SCOPE_PATH_PREFIX.length)
  return separator === -1 ? '/' : value.slice(separator) || '/'
}

export function addScopeToPath(pathname, scope) {
  if (typeof scope !== 'string' || !scope) throw new TypeError('scope is required')
  const unscopedPath = stripScopeFromPath(pathname)
  return `${SCOPE_PATH_PREFIX}${encodeURIComponent(scope)}${unscopedPath}`
}

export function scopeFromUrl(url) {
  return scopeFromPath(url.pathname) || url.searchParams.get(LEGACY_SCOPE_QUERY_PARAM)
}

export function queryWithoutLegacyScope(url) {
  const params = new URLSearchParams(url.search)
  params.delete(LEGACY_SCOPE_QUERY_PARAM)
  return params.toString()
}
