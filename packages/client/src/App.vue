<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { RuntimeStage } from '../../protocol/src/messages.js'
import IntroDialog from './components/IntroDialog.vue'
import LoadingScreen from './components/LoadingScreen.vue'
import TopBar from './components/TopBar.vue'
import { LOGIN_DEMO } from './playground/config.js'
import {
  PlaygroundEventType,
  createPlayground,
} from './playground/controller.js'
import {
  normalizeAddress,
  scopedFrameUrl,
  stripScope,
} from './playground/iframe-navigation.js'

const ready = ref(false)
const booting = ref(false)
const bootSteps = ref([
  { label: 'Booting Service Worker', status: 'pending', startTime: null, elapsed: null },
  { label: 'Loading Python Runtime', status: 'pending', startTime: null, elapsed: null },
  { label: 'Fetching Frappe Core', status: 'pending', startTime: null, elapsed: null },
  { label: 'Initializing Database', status: 'pending', startTime: null, elapsed: null },
  { label: 'Starting Frappe', status: 'pending', startTime: null, elapsed: null },
])
const stageIndexes = new Map([
  [RuntimeStage.SERVICE_WORKER, 0],
  [RuntimeStage.PYTHON, 1],
  [RuntimeStage.RUNTIME, 2],
  [RuntimeStage.DATABASE, 3],
  [RuntimeStage.FRAPPE, 4],
])
const address = ref('/')
const frameSrc = ref('')
const iframeRef = ref(null)
const instanceId = ref('')
const showIntroDialog = ref(true)

let addressTimer = 0
let playground = null
let hasPrefilledLogin = false

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
    } else if (status === 'done' && step.status !== 'done' && step.startTime) {
      step.elapsed = now - step.startTime
    }
    step.status = status
  }
}

function handleProgress({ stage, status }) {
  const index = stageIndexes.get(stage)
  if (index !== undefined) updateStep(index, status)
}

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

function syncAddressFromFrame() {
  try {
    const href = iframeRef.value?.contentWindow?.location?.href
    if (href) address.value = stripScope(href)
    prefillLoginIfApplicable()
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
  if (!ready.value) return

  try {
    iframeRef.value?.contentWindow?.location.reload()
  } catch (_) {
    frameSrc.value = frameUrl(normalizeAddress(address.value))
  }
}

async function initPlayground() {
  booting.value = true
  playground = createPlayground()
  playground.on(PlaygroundEventType.PROGRESS, handleProgress)
  playground.on(PlaygroundEventType.READY, ({ instanceId: id }) => {
    instanceId.value = id
    ready.value = true
    booting.value = false
    frameSrc.value = frameUrl('/')
    startAddressSync()
  })
  playground.on(PlaygroundEventType.ERROR, () => {
    ready.value = false
    booting.value = false
  })

  try {
    const session = await playground.start()
    instanceId.value = session.id
  } catch (_) {
    // The controller emits the user-facing error state.
  }
}

onMounted(initPlayground)

onBeforeUnmount(() => {
  clearInterval(addressTimer)
  playground?.dispose()
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
