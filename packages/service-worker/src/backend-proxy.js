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
  const message = JSON.stringify(associationMessage).replace(/</g, '\\u003c')
  const scopePrefix = JSON.stringify(`/scope:${encodeURIComponent(scope)}`)
  const virtualSiteHost = JSON.stringify(VIRTUAL_SITE_HOST)
  const virtualUserId = JSON.stringify(userId && userId !== 'Guest' ? userId : '')
  return `<script data-playground-scope-bootstrap>(function(){var s=navigator.serviceWorker;var i=${virtualUserId};var d=document,p=d,h;while(p&&!h){p=Object.getPrototypeOf(p);h=p&&Object.getOwnPropertyDescriptor(p,'cookie')}if(i&&h&&h.get&&h.set){try{Object.defineProperty(d,'cookie',{configurable:true,get:function(){var c=h.get.call(d).split('; ').filter(function(v){return v.indexOf('user_id=')!==0}).join('; ');return(c?c+'; ':'')+'user_id='+encodeURIComponent(i)},set:function(v){if(String(v).indexOf('user_id=')===0)return v;return h.set.call(d,v)}})}catch(e){}}function a(){var w=s&&s.controller;if(w)w.postMessage(${message})}function u(v){if(!v)return v;var r=String(v);if(r.charAt(0)==='#'||/^(?:mailto|tel|javascript|data|blob):/i.test(r))return v;try{var x=new URL(r,location.href);if(x.origin!==location.origin){if(x.hostname!==${virtualSiteHost}&&x.hostname!==location.hostname)return v;x.protocol=location.protocol;x.host=location.host}if(x.pathname.indexOf('/scope:')===0)return x.href;x.pathname=${scopePrefix}+(x.pathname.charAt(0)==='/'?x.pathname:'/'+x.pathname);return x.href}catch(e){return v}}a();if(s){s.addEventListener('controllerchange',a);s.ready.then(a)}addEventListener('pageshow',a);var f=window.fetch;if(f)window.fetch=function(i,n){try{i=i instanceof Request?new Request(u(i.url),i):u(i)}catch(e){}return f.call(this,i,n)};var q=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){if(arguments.length>1)arguments[1]=u(arguments[1]);return q.apply(this,arguments)};var o=window.open;window.open=function(){if(arguments.length)arguments[0]=u(arguments[0]);return o.apply(this,arguments)};addEventListener('click',function(e){var l=e.target&&e.target.closest&&e.target.closest('a[href]');if(l&&l.target==='_blank')l.href=u(l.href)},true);var p=location.pathname;var m=p.match(/^\\/scope:[^/]+(\\/.*|$)/);if(m){history.replaceState(history.state,'',(m[1]||'/')+location.search+location.hash)}})();</script>`
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
      channel.port1.onmessage = event => {
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
        resolve(new Response(responseBody, { status, headers: responseHeaders }))
      }
      instance.port.postMessage(payload, [channel.port2])
    })
  }
}
