import { SCOPE_BOOTSTRAP_SOURCE } from './scope-bootstrap.js'
import { scopeRedirectLocation, VIRTUAL_SITE_HOST } from './routing.js'

export function rewriteVirtualSiteUrls(body, headers, origin, scope) {
  const contentType = headers.get('Content-Type')?.toLowerCase() || ''
  if (!contentType.startsWith('text/')
    && !contentType.includes('json')
    && !contentType.includes('javascript')) return body

  const text = typeof body === 'string' ? body : new TextDecoder().decode(body)
  const playgroundOrigin = new URL(origin)
  const scopedOrigin = `${origin}/scope:${encodeURIComponent(scope)}`
  const scopedProtocolRelativeOrigin = `//${playgroundOrigin.host}/scope:${encodeURIComponent(scope)}`
  const escapedScopedOrigin = scopedOrigin.replaceAll('/', '\\/')
  const rewritten = text
    .replace(/https?:\/\/site1(?::\d+)?/g, scopedOrigin)
    .replace(/\/\/site1(?::\d+)?/g, scopedProtocolRelativeOrigin)
    .replace(/https?:\\\/\\\/site1(?::\d+)?/g, escapedScopedOrigin)
  if (rewritten !== text) headers.delete('Content-Length')
  return rewritten
}

function scopeBootstrapScript(scope, associationMessage, userId) {
  const options = JSON.stringify({
    scopePrefix: `/scope:${encodeURIComponent(scope)}`,
    virtualSiteHost: VIRTUAL_SITE_HOST,
    associationMessage,
    userId: userId && userId !== 'Guest' ? userId : '',
  }).replace(/</g, '\\u003c')
  return `<script data-playground-scope-bootstrap>${SCOPE_BOOTSTRAP_SOURCE}(${options});</script>`
}

export function rewriteScopedHtml(body, headers, scope, associationMessage, userId = '') {
  if (!scope || !headers.get('Content-Type')?.toLowerCase().startsWith('text/html')) {
    return body
  }

  const html = typeof body === 'string' ? body : new TextDecoder().decode(body)
  if (html.includes('data-playground-scope-bootstrap')) return html

  headers.delete('Content-Length')
  const bootstrap = scopeBootstrapScript(scope, associationMessage, userId)
  const head = /<head(?:\s[^>]*)?>/i.exec(html)
  if (!head) return `${bootstrap}${html}`

  const insertionPoint = head.index + head[0].length
  return `${html.slice(0, insertionPoint)}${bootstrap}${html.slice(insertionPoint)}`
}

export function createBackendProxy({
  MessageChannelClass,
  createBackendRequest,
  readBackendResponse,
  origin,
  createAssociateClientMessage,
  timeoutMs = 120000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  return async function callBackend({ request, instance, scope, path, query }) {
    if (!instance) {
      return new Response('Service Worker not fully initialized for this tab', {
        status: 503,
      })
    }

    const backendHeaders = new Headers(request.headers)
    // Frappe UI derives this header from the browser hostname. The runtime
    // serves a virtual site, so localhost would make POST/RPC requests fail
    // with "site does not exist" even though their scoped route is correct.
    backendHeaders.set('X-Frappe-Site-Name', VIRTUAL_SITE_HOST)
    const backendRequest = {
      method: request.method,
      path,
      query,
      headers: Object.fromEntries(backendHeaders.entries()),
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      backendRequest.body = await request.arrayBuffer()
    }

    const payload = createBackendRequest(backendRequest)
    return new Promise(resolve => {
      const channel = new MessageChannelClass()
      let settled = false
      let timeout
      const finish = response => {
        if (settled) return
        settled = true
        clearTimeoutFn(timeout)
        request.signal.removeEventListener('abort', abort)
        channel.port1.onmessage = null
        channel.port1.onmessageerror = null
        channel.port1.close?.()
        channel.port2.close?.()
        resolve(response)
      }
      const unavailable = () => finish(new Response('Runtime connection unavailable', {
        status: 503, headers: { 'Retry-After': '1' },
      }))
      const abort = () => finish(new Response('Request aborted', { status: 499 }))
      timeout = setTimeoutFn(() => finish(new Response('Runtime request timed out', {
        status: 504,
      })), timeoutMs)
      request.signal.addEventListener('abort', abort, { once: true })
      channel.port1.onmessageerror = unavailable
      channel.port1.onmessage = event => {
        try {
          const { status, headers, body } = readBackendResponse(event.data)
          const responseHeaders = new Headers(headers)
          responseHeaders.set('Cross-Origin-Resource-Policy', 'same-origin')
          responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp')
          responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin')
          const userId = responseHeaders.get('X-Playground-User-Id') || ''
          responseHeaders.delete('X-Playground-User-Id')
          scopeRedirectLocation(responseHeaders, scope, origin)
          const browserBody = rewriteVirtualSiteUrls(body, responseHeaders, origin, scope)
          const responseBody = rewriteScopedHtml(
            browserBody,
            responseHeaders,
            scope,
            createAssociateClientMessage(scope),
            userId,
          )
          finish(new Response([101, 204, 205, 304].includes(status) ? null : responseBody, {
            status, headers: responseHeaders,
          }))
        } catch (_) {
          unavailable()
        }
      }
      if (request.signal.aborted) return abort()
      try {
        instance.port.postMessage(payload, [channel.port2])
      } catch (_) {
        unavailable()
      }
    })
  }
}
