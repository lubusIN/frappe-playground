<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { RuntimeStage } from '../../protocol/src/messages.js'
import IntroDialog from './components/IntroDialog.vue'
import InfoDialog from './components/InfoDialog.vue'
import AppManagerDialog from './components/AppManagerDialog.vue'
import InstanceManagerDialog from './components/InstanceManagerDialog.vue'
import LoadingScreen from './components/LoadingScreen.vue'
import Dock from './components/Dock.vue'
import { LOGIN_DEMO } from './playground/config.js'
import { loadAppCatalog } from './playground/apps.js'
import {
  PlaygroundEventType,
  createPlayground,
} from './playground/controller.js'
import {
  normalizeAddress,
  scopedFrameUrl,
  stripScope,
} from './playground/iframe-navigation.js'
import { processBootFlags } from './playground/boot-flags.js'
import {
  createInstanceSession,
  deleteInstanceData,
  listInstanceSessions,
  removeInstanceSession,
  renameInstanceSession,
  selectInstanceSession,
} from './playground/session.js'


const ready = ref(false)
const booting = ref(false)
const bootError = ref('')
const bootSteps = ref([
  { label: 'Booting Worker', status: 'pending', startTime: null, elapsed: null },
  { label: 'Loading Runtime', status: 'pending', startTime: null, elapsed: null },
  { label: 'Loading Frappe', status: 'pending', startTime: null, elapsed: null },
  { label: 'Loading Database', status: 'pending', startTime: null, elapsed: null },
  { label: 'Starting Frappe', status: 'pending', startTime: null, elapsed: null },
])
const stageIndexes = new Map([
  [RuntimeStage.SERVICE_WORKER, 0],
  [RuntimeStage.PYTHON, 1],
  [RuntimeStage.RUNTIME, 2],
  [RuntimeStage.DATABASE, 3],
  [RuntimeStage.FRAPPE, 4],
])
const urlParams = new URLSearchParams(window.location.search)
const address = ref(urlParams.get('path') || '/')
const frameSrc = ref('')
const iframeRef = ref(null)
const instanceManagerRef = ref(null)
const instanceId = ref('')
const instances = ref([])
const showIntroDialog = ref(false)
const showInfoDialog = ref(false)
const showInstanceManager = ref(false)
const showAppManager = ref(false)
const availableApps = ref([])
const installedApps = ref([])
const appCatalogLoading = ref(false)
const appCatalogError = ref('')
const appInstallError = ref('')
const installingAppId = ref('')
const uninstallingAppId = ref('')
let appCatalogLoaded = false

let addressTimer = 0
let playground = null
let hasPrefilledLogin = false

function resetBootState() {
  ready.value = false
  booting.value = true
  bootError.value = ''
  frameSrc.value = ''
  let path = new URLSearchParams(window.location.search).get('path') || '/'
  if (path === '/blank') path = '/'
  address.value = path
  hasPrefilledLogin = false
  clearInterval(addressTimer)
  for (const step of bootSteps.value) {
    step.status = 'pending'
    step.startTime = null
    step.elapsed = null
  }
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

function reloadPage() {
  window.location.reload()
}

async function initPlayground(options = {}) {
  resetBootState()
  playground?.dispose()
  playground = createPlayground(options)
  playground.on(PlaygroundEventType.PROGRESS, handleProgress)
  const backendReady = new Promise((resolve, reject) => {
    const offReady = playground.on(PlaygroundEventType.READY, ({ instanceId: id }) => {
      offReady()
      offError()
      resolve(id)
    })
    const offError = playground.on(PlaygroundEventType.ERROR, ({ message }) => {
      ready.value = false
      booting.value = false
      bootError.value = message
      offReady()
      offError()
      reject(new Error(message))
    })
  })

  try {
    const session = await playground.start()
    instanceId.value = session.id
    instances.value = listInstanceSessions()
    
    await backendReady
    installedApps.value = playground.listInstalledApps()
    
    const params = new URLSearchParams(window.location.search)

    const result = await processBootFlags(params, {
      playground,
      instanceId: instanceId.value,
      installApp: async (appId) => {
        if (!appCatalogLoaded && !appCatalogLoading.value) {
          appCatalogLoading.value = true
          try {
            const catalog = await loadAppCatalog()
            availableApps.value = catalog.apps
            appCatalogLoaded = true
          } catch (_) {}
          appCatalogLoading.value = false
        }
        installingAppId.value = appId
        try {
          await playground.installApp(appId)
        } catch (e) {
          throw new Error(`Failed to install app '${appId}': ${e.message}`)
        } finally {
          installingAppId.value = ''
        }
      }
    })

    installedApps.value = playground.listInstalledApps()
    address.value = result.initialPath

    ready.value = true
    booting.value = false
    frameSrc.value = frameUrl(address.value)
    startAddressSync()
    
    if (session.freshSession && !result.autoLogin && !result.skipOnboarding) {
      showIntroDialog.value = true
    }
  } catch (error) {
    if (!bootError.value && error) {
      ready.value = false
      booting.value = false
      bootError.value = error.message || 'Playground initialization failed.'

      // If it failed during a fresh session setup, delete the corrupt session
      if (instanceId.value && playground?.session?.freshSession) {
        playground.dispose()
        deleteInstanceData(instanceId.value).catch(() => {})
        instances.value = removeInstanceSession(instanceId.value)
      }
    }
  }
}

async function openAppManager() {
  showAppManager.value = true
  appInstallError.value = ''
  installedApps.value = playground?.listInstalledApps() || []
  if (appCatalogLoaded || appCatalogLoading.value) return
  appCatalogLoading.value = true
  appCatalogError.value = ''
  try {
    const catalog = await loadAppCatalog()
    availableApps.value = catalog.apps
    appCatalogLoaded = true
  } catch (error) {
    appCatalogError.value = error.message || 'Could not load the app catalog.'
  } finally {
    appCatalogLoading.value = false
  }
}

function retryAppCatalog() {
  appCatalogLoaded = false
  openAppManager()
}

async function installApp(appId) {
  if (!playground || installingAppId.value || uninstallingAppId.value) return
  installingAppId.value = appId
  appInstallError.value = ''
  try {
    await playground.installApp(appId)
    installedApps.value = playground.listInstalledApps()
    window.location.reload()
  } catch (error) {
    appInstallError.value = error.message || `Could not install ${appId}.`
  } finally {
    installingAppId.value = ''
  }
}

async function uninstallApp(appId) {
  if (!playground || installingAppId.value || uninstallingAppId.value) return
  uninstallingAppId.value = appId
  appInstallError.value = ''
  try {
    await playground.uninstallApp(appId)
    installedApps.value = playground.listInstalledApps()
    window.location.reload()
  } catch (error) {
    appInstallError.value = error.message || `Could not uninstall ${appId}.`
  } finally {
    uninstallingAppId.value = ''
  }
}

function createInstance(name) {
  const session = createInstanceSession({ name })
  instances.value = listInstanceSessions()
  showInstanceManager.value = false
  initPlayground({ session })
}

function selectInstance(id) {
  if (!id || id === instanceId.value) return
  showInstanceManager.value = false
  initPlayground({ instanceId: id })
}

function renameInstance({ id, name }) {
  const renamed = renameInstanceSession(id, name)
  if (renamed) instances.value = listInstanceSessions()
}

async function resetInstance(id) {
  const isActive = id === instanceId.value
  const instance = instances.value.find(item => item.id === id)
  if (isActive) playground?.dispose()

  try {
    await deleteInstanceData(id)
    if (isActive && instance) {
      showInstanceManager.value = false
      initPlayground({ session: { ...instance, freshSession: true } })
    }
  } catch (error) {
    window.alert(error.message)
  }
}

async function deleteInstance(id) {
  const isActive = id === instanceId.value
  if (isActive) playground?.dispose()

  try {
    await deleteInstanceData(id)
    const remaining = removeInstanceSession(id)
    instances.value = remaining
    if (!isActive) return

    showInstanceManager.value = false
    if (remaining.length) {
      initPlayground({ instanceId: remaining[0].id })
    } else {
      const replacement = createInstanceSession({ name: 'My Playground' })
      initPlayground({ session: replacement })
    }
  } catch (error) {
    window.alert(error.message)
  }
}

onMounted(() => {
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'frappe-playground-nested-shell') {
      console.warn('[Playground] Parent caught nested shell. Fixing iframe URL...')
      let targetUrl = frameUrl(normalizeAddress(event.data.href))
      // Append a cache buster so Vue's reactivity guarantees a DOM update and navigation
      const separator = targetUrl.includes('?') ? '&' : '?'
      targetUrl += `${separator}_frappe_playground_bounce=${Date.now()}`
      frameSrc.value = targetUrl
    }
  })

  const params = new URLSearchParams(window.location.search)
  let sessionToBoot = undefined
  
  const name = params.get('name')
  if (name) {
    const existing = listInstanceSessions().find(i => i.name === name)
    if (existing) {
      sessionToBoot = selectInstanceSession(existing.id)
    } else {
      sessionToBoot = createInstanceSession({ name })
    }
  } else if (params.get('onboarding') || params.get('apps')) {
    sessionToBoot = createInstanceSession()
  }

  if (sessionToBoot) {
    initPlayground({ session: sessionToBoot })
  } else {
    initPlayground()
  }
})

onBeforeUnmount(() => {
  clearInterval(addressTimer)
  playground?.dispose()
})
</script>

<template>
  <main class="relative flex h-screen w-screen flex-col overflow-hidden bg-gray-50 dark:bg-gray-900 supports-[height:100dvh]:h-dvh">
    <Dock
      v-show="ready"
      v-model:address="address"
      :active-instance-id="instanceId"
      :instances="instances"
      :ready="ready"
      @create-instance="showInstanceManager = true; instanceManagerRef?.startCreating()"
      @manage-instances="showInstanceManager = true"
      @manage-apps="openAppManager"
      @show-info="showInfoDialog = true"
      @navigate="navigateFrame"
      @reload="reloadFrame"
    />

    <LoadingScreen
      v-show="!ready"
      :booting="booting"
      :error="bootError"
      :steps="bootSteps"
      @retry="reloadPage"
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
    <InfoDialog v-if="ready" v-model="showInfoDialog" :boot-steps="bootSteps" />
    <AppManagerDialog
      v-if="ready"
      v-model="showAppManager"
      :apps="availableApps"
      :installed-apps="installedApps"
      :loading="appCatalogLoading"
      :error="appCatalogError"
      :install-error="appInstallError"
      :installing-app-id="installingAppId"
      :uninstalling-app-id="uninstallingAppId"
      @install="installApp"
      @retry="retryAppCatalog"
      @uninstall="uninstallApp"
    />
    <InstanceManagerDialog
      ref="instanceManagerRef"
      v-if="ready"
      v-model="showInstanceManager"
      :active-instance-id="instanceId"
      :instances="instances"
      @create="createInstance"
      @delete="deleteInstance"
      @reset="resetInstance"
      @rename="renameInstance"
      @select="selectInstance"
    />
  </main>
</template>
