// This function is serialized into HTML. Keep it self-contained: no imports or closures.
export function installScopeBootstrap({ scopePrefix, virtualSiteHost, associationMessage, userId }) {
  const serviceWorker = navigator.serviceWorker
  const doc = document
  let prototype = doc
  let cookieDescriptor
  while (prototype && !cookieDescriptor) {
    prototype = Object.getPrototypeOf(prototype)
    cookieDescriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'cookie')
  }
  if (userId && cookieDescriptor?.get && cookieDescriptor?.set) {
    try {
      Object.defineProperty(doc, 'cookie', {
        configurable: true,
        get() {
          const cookies = cookieDescriptor.get.call(doc).split('; ')
            .filter(cookie => !cookie.startsWith('user_id=')).join('; ')
          return `${cookies ? `${cookies}; ` : ''}user_id=${encodeURIComponent(userId)}`
        },
        set(value) {
          if (String(value).startsWith('user_id=')) return value
          return cookieDescriptor.set.call(doc, value)
        },
      })
    } catch (_) {}
  }

  function associateClient() {
    serviceWorker?.controller?.postMessage(associationMessage)
  }

  function scopedUrl(value) {
    if (!value) return value
    const raw = String(value)
    if (raw.startsWith('#') || /^(?:mailto|tel|javascript|data|blob):/i.test(raw)) return value
    try {
      const url = new URL(raw, location.href)
      if (url.origin !== location.origin) {
        if (url.hostname !== virtualSiteHost && url.hostname !== location.hostname) return value
        url.protocol = location.protocol
        url.host = location.host
      }
      if (!url.pathname.startsWith('/scope:')) url.pathname = scopePrefix + url.pathname
      return url.href
    } catch (_) {
      return value
    }
  }

  associateClient()
  if (serviceWorker) {
    serviceWorker.addEventListener('controllerchange', associateClient)
    serviceWorker.ready.then(associateClient)
  }
  addEventListener('pageshow', associateClient)

  const originalFetch = window.fetch
  if (originalFetch) window.fetch = function (input, options) {
    try {
      input = input instanceof Request ? new Request(scopedUrl(input.url), input) : scopedUrl(input)
    } catch (_) {}
    return originalFetch.call(this, input, options)
  }
  const originalXhrOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (...args) {
    if (args.length > 1) args[1] = scopedUrl(args[1])
    return originalXhrOpen.apply(this, args)
  }
  const originalOpen = window.open
  window.open = function (...args) {
    if (args.length) args[0] = scopedUrl(args[0])
    return originalOpen.apply(this, args)
  }
  addEventListener('click', event => {
    const link = event.target?.closest?.('a[href]')
    if (link?.target === '_blank') link.href = scopedUrl(link.href)
  }, true)

  const match = location.pathname.match(/^\/scope:[^/]+(\/.*|$)/)
  if (match) history.replaceState(history.state, '', (match[1] || '/') + location.search + location.hash)
}

export const SCOPE_BOOTSTRAP_SOURCE = `(${installScopeBootstrap.toString()})`
