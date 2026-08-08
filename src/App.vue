<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue'
import IntroDialog from './components/IntroDialog.vue'
import LoadingScreen from './components/LoadingScreen.vue'
import TopBar from './components/TopBar.vue'
import { SITE_CONFIG } from '../playground-server/src/config.js'
import {
  ProtocolMessageType,
  createClaimClientsMessage,
  createClearOtherInstancesMessage,
  createInitChannelMessage,
  isProtocolMessage,
} from '../packages/protocol/src/index.js'

const sessionKey = 'frappe_playground_instance_id'
const ready = ref(false)
const booting = ref(false)
const bootSteps = ref([
  { label: 'Booting Service Worker', status: 'pending', startTime: null, elapsed: null },
  { label: 'Loading Python Runtime', status: 'pending', startTime: null, elapsed: null },
  { label: 'Fetching Frappe Core', status: 'pending', startTime: null, elapsed: null },
  { label: 'Initializing Database', status: 'pending', startTime: null, elapsed: null },
  { label: 'Starting Frappe', status: 'pending', startTime: null, elapsed: null },
])
const address = ref('/')
const frameSrc = ref('')
const iframeRef = ref(null)
const instanceId = ref('')
const showIntroDialog = ref(true)

let addressTimer = 0
let pyWorker = null
let hasPrefilledLogin = false


function getOrCreateInstanceId() {
  let id = localStorage.getItem(sessionKey)
  const freshSession = !id

  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    localStorage.setItem(sessionKey, id)
  }

  return { id, freshSession }
}

function updateStep(index, status) {
  const now = performance.now()
  for (let i = 0; i < index; i++) {
    if (bootSteps.value[i].status !== 'done') {
      bootSteps.value[i].status = 'done'
      if (bootSteps.value[i].startTime) {
        bootSteps.value[i].elapsed = now - bootSteps.value[i].startTime
      }
    }
  }

  const step = bootSteps.value[index]
  if (step.status !== 'done' || status === 'done') {
    if (status === 'active' && step.status !== 'active') {
      step.startTime = now
    } else if (status === 'done' && step.status !== 'done') {
      if (step.startTime) {
        step.elapsed = now - step.startTime
      }
    }
    step.status = status
  }
}

function setBootLog(message) {
  if (!message) return
  const m = message.toLowerCase()
  if (m.includes('service worker')) {
    updateStep(0, 'active')
  } else if (m.includes('configuring python') || m.includes('frappe booted')) {
    updateStep(4, 'active')
    if (m.includes('booted successfully')) updateStep(4, 'done')
  } else if (m.includes('pyodide') || m.includes('python') || m.includes('core packages')) {
    updateStep(1, 'active')
  } else if (m.includes('fetching frappe') || m.includes('virtual filesystem')) {
    updateStep(2, 'active')
  } else if (m.includes('database')) {
    updateStep(3, 'active')
  }
}

function normalizeAddress(value) {
  const trimmed = String(value || '/').trim()
  if (!trimmed) return '/'

  try {
    const parsed = new URL(trimmed, window.location.origin)
    return `${parsed.pathname || '/'}${parsed.search}${parsed.hash}`
  } catch (_) {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  }
}

function stripScope(value) {
  const parsed = new URL(value, window.location.origin)
  parsed.searchParams.delete('__scope')
  const search = parsed.searchParams.toString()
  return `${parsed.pathname || '/'}${search ? `?${search}` : ''}${parsed.hash}`
}

function scopedFrameUrl(value) {
  const parsed = new URL(normalizeAddress(value), window.location.origin)
  parsed.searchParams.set('__scope', instanceId.value)
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function prefillLoginIfApplicable() {
  if (hasPrefilledLogin || !SITE_CONFIG.prefill_login_credentials) return

  try {
    const win = iframeRef.value?.contentWindow
    const doc = win?.document
    if (!doc) return

    const usr = doc.querySelector('#login_email')
    const pwd = doc.querySelector('#login_password')
    if (usr && pwd) {
      hasPrefilledLogin = true
      
      usr.value = SITE_CONFIG.prefill_login_user
      usr.setAttribute('value', SITE_CONFIG.prefill_login_user)
      usr.dispatchEvent(new Event('input', { bubbles: true }))
      usr.dispatchEvent(new Event('change', { bubbles: true }))
      
      pwd.value = SITE_CONFIG.prefill_login_pwd
      pwd.setAttribute('value', SITE_CONFIG.prefill_login_pwd)
      pwd.dispatchEvent(new Event('input', { bubbles: true }))
      pwd.dispatchEvent(new Event('change', { bubbles: true }))
    }
  } catch (_) {
    // ignore cross-origin or transient access errors
  }
}

function syncAddressFromFrame() {
  try {
    const href = iframeRef.value?.contentWindow?.location?.href
    if (href) address.value = stripScope(href)
    prefillLoginIfApplicable()
  } catch (_) {
    // The playground is expected to be same-origin, but ignore transient frame swaps.
  }
}

function startAddressSync() {
  window.clearInterval(addressTimer)
  addressTimer = window.setInterval(syncAddressFromFrame, 500)
}

function navigateFrame() {
  if (!ready.value) return
  frameSrc.value = scopedFrameUrl(normalizeAddress(address.value))
  nextTick(syncAddressFromFrame)
}

function reloadFrame() {
  if (!ready.value) return

  try {
    iframeRef.value?.contentWindow?.location.reload()
  } catch (_) {
    frameSrc.value = scopedFrameUrl(normalizeAddress(address.value))
  }
}

async function initPlayground() {
  if (!('serviceWorker' in navigator)) {
    setBootLog('Service workers are unavailable in this browser.')
    return
  }

  booting.value = true
  bootSteps.value[0].startTime = performance.now()
  setBootLog('Starting service worker...')

  const session = getOrCreateInstanceId()
  instanceId.value = session.id

  let isInitialLoad = !navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isInitialLoad) {
      isInitialLoad = false
    } else {
      console.log("[Playground] Service Worker updated! Auto-reloading to apply changes...")
      window.location.reload()
    }
  })

  const swRegistration = await navigator.serviceWorker.register('/sw.js', {
    type: 'module',
  })

  if (!navigator.serviceWorker.controller) {
    if (swRegistration.active) {
      swRegistration.active.postMessage(createClaimClientsMessage())
    }
    
    setBootLog('Connecting service worker...')
    await new Promise(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, {
        once: true,
      })
    })
  }

  setBootLog(
    swRegistration.active
      ? 'Preparing Python runtime...'
      : 'Activating service worker...',
  )

  pyWorker = new Worker(`/worker.js?scope=${session.id}&fresh=${session.freshSession}`, { type: 'module' })

  function setupChannel() {
    const sendInit = (sw) => {
      if (sw) {
        const channel = new MessageChannel()
        
        sw.postMessage(createInitChannelMessage(session.id), [channel.port1])
        if (session.freshSession) {
          sw.postMessage(createClearOtherInstancesMessage(session.id))
        }
        
        pyWorker.postMessage(
          createInitChannelMessage(session.id, {
            freshSession: session.freshSession,
          }),
          [channel.port2],
        )
      }
    }

    if (navigator.serviceWorker.controller) {
      sendInit(navigator.serviceWorker.controller)
    } else {
      navigator.serviceWorker.ready.then(reg => sendInit(reg.active))
    }
  }

  setupChannel()

  window.swRecoveryChannel = new BroadcastChannel('sw-recovery')
  window.swRecoveryChannel.onmessage = event => {
    if (isProtocolMessage(event.data, ProtocolMessageType.RECOVERY_REQUEST)) {
      console.log("[Playground] SW requested channel re-init (via BroadcastChannel). Re-establishing...")
      setupChannel()
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      // Proactively ensure the SW is connected when the tab wakes up
      setupChannel();
    }
  });

  pyWorker.onmessage = event => {
    if (isProtocolMessage(event.data, ProtocolMessageType.RUNTIME_LOG)) {
      setBootLog(event.data.payload.message)
      return
    }

    if (isProtocolMessage(event.data, ProtocolMessageType.RUNTIME_READY)) {
      updateStep(4, 'done')
      setTimeout(() => {
        ready.value = true
        booting.value = false
        frameSrc.value = scopedFrameUrl('/')
        startAddressSync()
      }, 2000)
      return
    }

    if (isProtocolMessage(event.data, ProtocolMessageType.RUNTIME_ERROR)) {
      ready.value = false
      booting.value = false
      setBootLog(event.data.payload.message)
    }
  }

  pyWorker.onerror = error => {
    booting.value = false
    setBootLog(error.message || 'Frappe runtime failed to start.')
  }
}

window.addEventListener('load', initPlayground, { once: true })

onBeforeUnmount(() => {
  window.clearInterval(addressTimer)
  pyWorker?.terminate()
})
</script>

<template>
  <main
    class="grid h-screen w-screen overflow-hidden bg-gray-50 dark:bg-gray-900 supports-[height:100dvh]:h-dvh"
    :class="
      ready
        ? 'grid-rows-[44px_minmax(0,1fr)] max-sm:grid-rows-[84px_minmax(0,1fr)]'
        : 'grid-rows-[minmax(0,1fr)]'
    "
  >
    <TopBar
      v-show="ready"
      v-model:address="address"
      :ready="ready"
      @navigate="navigateFrame"
      @reload="reloadFrame"
    />

    <LoadingScreen 
      v-show="!ready" 
      :booting="booting" 
      :steps="bootSteps"
    />

    <iframe
      id="frappe-desk"
      ref="iframeRef"
      :src="frameSrc"
      class="h-full min-h-0 w-full border-0 bg-white dark:bg-gray-900"
      :class="ready ? 'block' : 'hidden'"
      title="Frappe Desk"
      @load="syncAddressFromFrame"
    />

    <IntroDialog v-if="ready" v-model="showIntroDialog" />
  </main>
</template>
