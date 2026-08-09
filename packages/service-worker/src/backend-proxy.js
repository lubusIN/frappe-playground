import { scopeRedirectLocation } from './routing.js'

function scopeBootstrapScript(scope, associationMessage) {
  const message = JSON.stringify(associationMessage).replace(/</g, '\\u003c')
  const scopePrefix = JSON.stringify(`/scope:${encodeURIComponent(scope)}`)
  return `<script data-playground-scope-bootstrap>(function(){var s=navigator.serviceWorker;function a(){var w=s&&s.controller;if(w)w.postMessage(${message})}function u(v){if(!v)return v;var r=String(v);if(r.charAt(0)==='#'||/^(?:mailto|tel|javascript|data|blob):/i.test(r))return v;try{var x=new URL(r,location.href);if(x.origin!==location.origin||x.pathname.indexOf('/scope:')===0)return v;x.pathname=${scopePrefix}+(x.pathname.charAt(0)==='/'?x.pathname:'/'+x.pathname);return x.href}catch(e){return v}}a();if(s){s.addEventListener('controllerchange',a);s.ready.then(a)}addEventListener('pageshow',a);var o=window.open;window.open=function(){if(arguments.length)arguments[0]=u(arguments[0]);return o.apply(this,arguments)};addEventListener('click',function(e){var l=e.target&&e.target.closest&&e.target.closest('a[href]');if(l&&l.target==='_blank')l.href=u(l.href)},true);var p=location.pathname;var m=p.match(/^\\/scope:[^/]+(\\/.*|$)/);if(m){history.replaceState(history.state,'',(m[1]||'/')+location.search+location.hash)}})();</script>`
}

export function rewriteScopedHtml(body, headers, scope, associationMessage) {
  if (!scope || !headers.get('Content-Type')?.toLowerCase().startsWith('text/html')) {
    return body
  }

  const html = typeof body === 'string' ? body : new TextDecoder().decode(body)
  if (html.includes('data-playground-scope-bootstrap')) return html

  headers.delete('Content-Length')
  const bootstrap = scopeBootstrapScript(scope, associationMessage)
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
        const responseBody = rewriteScopedHtml(
          body,
          responseHeaders,
          scope,
          createAssociateClientMessage(scope),
        )
        resolve(new Response(responseBody, { status, headers: responseHeaders }))
      }
      instance.port.postMessage(payload, [channel.port2])
    })
  }
}
