export const SCOPE_PATH_PREFIX = '/scope:'
export const LEGACY_SCOPE_QUERY_PARAM = '__scope'
export const INSTANCE_DB_PREFIX = 'frappe_playground_db_'

/**
 * Returns the scoped IndexedDB database name for a playground instance.
 * @param {string} scope - Instance identifier.
 * @returns {string} Database name.
 */
export function getInstanceDatabaseName(scope) {
  if (typeof scope !== 'string' || !scope) throw new TypeError('scope is required')
  return `${INSTANCE_DB_PREFIX}${scope}`
}

/**
 * Extracts the scope identifier from a scoped URL pathname.
 * @param {string} pathname - URL pathname.
 * @returns {string | null} Decoded scope identifier or null.
 */
export function scopeFromPath(pathname) {
  const match = String(pathname || '').match(/^\/scope:([^/]+)(?:\/|$)/)
  if (!match) return null

  try {
    return decodeURIComponent(match[1]) || null
  } catch (_) {
    return null
  }
}

/**
 * Strips the leading /scope:<id> prefix from a pathname.
 * @param {string} pathname - URL pathname.
 * @returns {string} Unscoped pathname.
 */
export function stripScopeFromPath(pathname) {
  const value = String(pathname || '/')
  if (!scopeFromPath(value)) return value.startsWith('/') ? value : `/${value}`

  const separator = value.indexOf('/', SCOPE_PATH_PREFIX.length)
  return separator === -1 ? '/' : value.slice(separator) || '/'
}

/**
 * Returns the leading /scope:<id> prefix for a given instance scope.
 * @param {string} scope - Instance identifier.
 * @returns {string} Scope path prefix.
 */
export function scopePrefix(scope) {
  if (typeof scope !== 'string' || !scope) throw new TypeError('scope is required')
  return `${SCOPE_PATH_PREFIX}${encodeURIComponent(scope)}`
}

/**
 * Adds a /scope:<id> prefix to a pathname.
 * @param {string} pathname - URL pathname.
 * @param {string} scope - Instance identifier.
 * @returns {string} Scoped pathname.
 */
export function addScopeToPath(pathname, scope) {
  const unscopedPath = stripScopeFromPath(pathname)
  return `${scopePrefix(scope)}${unscopedPath}`
}

/**
 * Resolves the scope identifier from either path or query parameter.
 * @param {URL} url - URL instance.
 * @returns {string | null} Scope identifier or null.
 */
export function scopeFromUrl(url) {
  return scopeFromPath(url.pathname) || url.searchParams.get(LEGACY_SCOPE_QUERY_PARAM)
}

/**
 * Removes the legacy scope query parameter from a URL search string.
 * @param {URL} url - URL instance.
 * @returns {string} Cleaned query string.
 */
export function queryWithoutLegacyScope(url) {
  const params = new URLSearchParams(url.search)
  params.delete(LEGACY_SCOPE_QUERY_PARAM)
  return params.toString()
}
