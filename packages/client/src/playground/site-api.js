import { scopedFrameUrl } from './iframe-navigation.js'

async function assertResponse(res, action) {
  if (res.ok) return res
  let detail = `${res.status} ${res.statusText}`
  try {
    const body = await res.json()
    // Frappe wraps errors in exc_type / _server_messages
    const serverMsg = body._server_messages
      ? JSON.parse(body._server_messages)?.[0]
      : body.exc_type || body.message
    if (serverMsg) detail = `${detail} — ${serverMsg}`
  } catch (_) {}
  throw new Error(`${action} failed: ${detail}`)
}

export function createSiteApi({ instanceId, signal, fetchFn = globalThis.fetch }) {
  return async (path, options, action) => {
    const response = await fetchFn(scopedFrameUrl(path, instanceId), { ...options, signal })
    return assertResponse(response, action)
  }
}
