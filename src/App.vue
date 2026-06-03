<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import IntroDialog from './components/IntroDialog.vue'
import LoadingScreen from './components/LoadingScreen.vue'
import TopBar from './components/TopBar.vue'

const sessionKey = 'frappe_playground_instance_id'
const ready = ref(false)
const booting = ref(false)
const bootLog = ref('Waiting for the browser runtime...')
const address = ref('/')
const frameSrc = ref('')
const iframeRef = ref(null)
const instanceId = ref('')
const showIntroDialog = ref(true)

let addressTimer = 0
let pyWorker = null

const normalizedAddress = computed(() => normalizeAddress(address.value))

function getOrCreateInstanceId() {
  let id = sessionStorage.getItem(sessionKey)
  const freshSession = !id

  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    sessionStorage.setItem(sessionKey, id)
  }

  return { id, freshSession }
}

function setBootLog(message) {
  bootLog.value = message || bootLog.value
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

function syncAddressFromFrame() {
  try {
    const href = iframeRef.value?.contentWindow?.location?.href
    if (href) address.value = stripScope(href)
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
  frameSrc.value = scopedFrameUrl(normalizedAddress.value)
  nextTick(syncAddressFromFrame)
}

function reloadFrame() {
  if (!ready.value) return

  try {
    iframeRef.value?.contentWindow?.location.reload()
  } catch (_) {
    frameSrc.value = scopedFrameUrl(normalizedAddress.value)
  }
}

async function initPlayground() {
  if (!('serviceWorker' in navigator)) {
    setBootLog('Service workers are unavailable in this browser.')
    return
  }

  booting.value = true
  setBootLog('Starting service worker...')

  const session = getOrCreateInstanceId()
  instanceId.value = session.id

  const swRegistration = await navigator.serviceWorker.register('/sw.js')
  if (!navigator.serviceWorker.controller) {
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

  pyWorker = new Worker('/worker.js', { type: 'module' })

  const channel = new MessageChannel()
  navigator.serviceWorker.controller.postMessage(
    { type: 'INIT_CHANNEL', scope: session.id },
    [channel.port1],
  )

  pyWorker.postMessage(
    {
      type: 'INIT_CHANNEL',
      freshSession: session.freshSession,
      scope: session.id,
    },
    [channel.port2],
  )

  pyWorker.onmessage = event => {
    if (event.data?.type === 'LOG') {
      setBootLog(event.data.message)
      return
    }

    if (event.data?.type === 'READY') {
      ready.value = true
      booting.value = false
      frameSrc.value = scopedFrameUrl('/')
      startAddressSync()
      return
    }

    if (event.data?.type === 'ERROR') {
      ready.value = false
      booting.value = false
      setBootLog(event.data.message)
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
    class="grid h-screen w-screen overflow-hidden bg-[#0a0a0a] supports-[height:100dvh]:h-dvh"
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

    <LoadingScreen v-show="!ready" :booting="booting" :message="bootLog" />

    <iframe
      id="frappe-desk"
      ref="iframeRef"
      :src="frameSrc"
      class="h-full min-h-0 w-full border-0 bg-white"
      :class="ready ? 'block' : 'hidden'"
      title="Frappe Desk"
      @load="syncAddressFromFrame"
    />

    <IntroDialog v-if="ready" v-model="showIntroDialog" />
  </main>
</template>
