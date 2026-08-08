import { scopeRedirectLocation } from './routing.js'

export function createBackendProxy({
  MessageChannelClass,
  createBackendRequest,
  readBackendResponse,
  origin,
}) {
  return async function callBackend({ request, instance, scope, path, query }) {
    if (!instance) {
      return new Response('Service Worker not fully initialized for this tab', {
        status: 503,
      })
    }

    const backendRequest = {
      method: request.method,
      path,
      query,
      headers: Object.fromEntries(request.headers.entries()),
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      backendRequest.body = await request.arrayBuffer()
    }

    const payload = createBackendRequest(backendRequest)
    return new Promise(resolve => {
      const channel = new MessageChannelClass()
      channel.port1.onmessage = event => {
        const { status, headers, body } = readBackendResponse(event.data)
        const responseHeaders = new Headers(headers)
        responseHeaders.set('Cross-Origin-Resource-Policy', 'same-origin')
        responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp')
        responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin')
        scopeRedirectLocation(responseHeaders, scope, origin)
        resolve(new Response(body, { status, headers: responseHeaders }))
      }
      instance.port.postMessage(payload, [channel.port2])
    })
  }
}
