import {
  addScopeToPath,
  queryWithoutLegacyScope,
  stripScopeFromPath,
} from '../../../protocol/src/scope-url.js'

function browserOrigin() {
  return globalThis.location?.origin || 'http://localhost'
}

export function normalizeAddress(value, origin = browserOrigin()) {
  const trimmed = String(value || '/').trim()
  if (!trimmed) return '/'

  try {
    const parsed = new URL(trimmed, origin)
    return `${parsed.pathname || '/'}${parsed.search}${parsed.hash}`
  } catch (_) {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  }
}

export function stripScope(value, origin = browserOrigin()) {
  const parsed = new URL(value, origin)
  const search = queryWithoutLegacyScope(parsed)
  return `${stripScopeFromPath(parsed.pathname)}${search ? `?${search}` : ''}${parsed.hash}`
}

export function scopedFrameUrl(value, instanceId, origin = browserOrigin()) {
  if (!instanceId) throw new TypeError('instanceId is required')

  const parsed = new URL(normalizeAddress(value, origin), origin)
  const search = queryWithoutLegacyScope(parsed)
  return `${addScopeToPath(parsed.pathname, instanceId)}${search ? `?${search}` : ''}${parsed.hash}`
}
