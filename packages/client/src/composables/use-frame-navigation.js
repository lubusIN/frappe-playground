import { nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import { parseBootOptions } from '../playground/boot-options.js'
import { LOGIN_DEMO } from '../playground/config.js'
import { normalizeAddress, scopedFrameUrl, stripScope } from '../playground/iframe-navigation.js'

export function useFrameNavigation({ ready, instanceId }) {
  const address = ref('/')
  const frameSrc = ref('')
  const iframeRef = ref(null)
  let addressTimer = 0
  let hasPrefilledLogin = false

  function frameUrl(value) {
    return scopedFrameUrl(value, instanceId.value)
  }

  function prefillLoginIfApplicable() {
    if (hasPrefilledLogin || !LOGIN_DEMO.prefill) return

    try {
      const doc = iframeRef.value?.contentWindow?.document
      if (!doc) return

      const usr = doc.querySelector('#login_email')
      const pwd = doc.querySelector('#login_password')
      if (usr && pwd) {
        hasPrefilledLogin = true

        usr.value = LOGIN_DEMO.username
        usr.setAttribute('value', LOGIN_DEMO.username)
        usr.dispatchEvent(new Event('input', { bubbles: true }))
        usr.dispatchEvent(new Event('change', { bubbles: true }))

        pwd.value = LOGIN_DEMO.password
        pwd.setAttribute('value', LOGIN_DEMO.password)
        pwd.dispatchEvent(new Event('input', { bubbles: true }))
        pwd.dispatchEvent(new Event('change', { bubbles: true }))
      }
    } catch (_) {
      // Ignore cross-origin or transient access errors.
    }
  }

  function injectSafariPasswordFix() {
    try {
      const doc = iframeRef.value?.contentWindow?.document
      if (!doc || !doc.head || doc.getElementById('safari-pwd-fix')) return
      const style = doc.createElement('style')
      style.id = 'safari-pwd-fix'
      style.textContent = 'input[type="password"] { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; }'
      doc.head.appendChild(style)
    } catch (_) {
      // Ignore cross-origin or transient access errors.
    }
  }

  function syncAddressFromFrame() {
    try {
      const iframeWindow = iframeRef.value?.contentWindow
      const href = iframeWindow?.location?.href
      if (href && !href.startsWith('about:')) {
        let displayHref = href
        if (displayHref.includes('_frappe_playground_bounce=')) {
          try {
            const url = new URL(displayHref)
            url.searchParams.delete('_frappe_playground_bounce')
            displayHref = url.href
          } catch (_) {}
        }
        address.value = stripScope(displayHref)
      }
      prefillLoginIfApplicable()
      injectSafariPasswordFix()

      // Sync dark mode from Frappe to the parent shell to prevent white flashes
      const doc = iframeWindow?.document
      if (doc) {
        const isDark = doc.documentElement.getAttribute('data-theme') === 'dark' || doc.documentElement.classList.contains('dark')
        if (isDark) {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
      }
    } catch (_) {
      // The playground is expected to be same-origin, but frame swaps are transient.
    }
  }

  function startAddressSync() {
    clearInterval(addressTimer)
    addressTimer = setInterval(syncAddressFromFrame, 500)
  }

  function navigateFrame() {
    if (!ready.value) return
    frameSrc.value = frameUrl(normalizeAddress(address.value))
    nextTick(syncAddressFromFrame)
  }

  function reloadFrame() {
    if (!ready.value || !iframeRef.value) return

    try {
      const url = frameUrl(normalizeAddress(address.value))
      frameSrc.value = url
      // Force reload by re-assigning the src property directly on the DOM element
      iframeRef.value.src = url
    } catch (_) {
      // Ignore transient cross-origin errors
    }
  }

  function resetFrame() {
    stopAddressSync()
    frameSrc.value = ''
    address.value = parseBootOptions(new URLSearchParams(window.location.search)).initialPath
    hasPrefilledLogin = false
  }

  function stopAddressSync() {
    clearInterval(addressTimer)
  }

  function handleNestedShell(event) {
    if (event.origin !== window.location.origin || event.source !== iframeRef.value?.contentWindow) return
    if (event.data?.type !== 'frappe-playground-nested-shell') return
    const targetUrl = frameUrl(normalizeAddress(event.data.href))
    const separator = targetUrl.includes('?') ? '&' : '?'
    frameSrc.value = `${targetUrl}${separator}_frappe_playground_bounce=${Date.now()}`
  }

  onMounted(() => window.addEventListener('message', handleNestedShell))
  onBeforeUnmount(() => {
    stopAddressSync()
    window.removeEventListener('message', handleNestedShell)
  })
  return { address, frameSrc, iframeRef, frameUrl, syncAddressFromFrame, startAddressSync,
    navigateFrame, reloadFrame, resetFrame, stopAddressSync }
}
