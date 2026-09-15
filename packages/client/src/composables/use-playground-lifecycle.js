import { computed, onBeforeUnmount, ref } from 'vue'
import { RuntimeStage } from '../../../protocol/src/messages.js'
import { PlaygroundEventType, createPlayground } from '../playground/controller.js'
import { listInstanceSessions } from '../playground/session.js'
import { processBootFlags } from '../playground/boot-flags.js'
import { useFrameNavigation } from './use-frame-navigation.js'
import { useAppManager } from './use-app-manager.js'

export function usePlaygroundLifecycle({
  createRuntime = createPlayground,
  processFlags = processBootFlags,
  listSessions = listInstanceSessions,
} = {}) {
  const runtimeState = ref('idle')
  const ready = computed(() => runtimeState.value === 'ready')
  const booting = computed(() => runtimeState.value === 'starting')
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
  const instanceId = ref('')
  const instances = ref([])
  const showIntroDialog = ref(false)
  let playground = null
  const frame = useFrameNavigation({ ready, instanceId })
  const apps = useAppManager(() => playground)
  const { installedApps } = apps
  const { address, frameSrc, frameUrl, startAddressSync } = frame

  function resetBootState() {
    runtimeState.value = 'starting'
    bootError.value = ''
    showIntroDialog.value = false
    frame.resetFrame()
    apps.resetAppState()
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

  async function initPlayground(options = {}) {
    resetBootState()
    playground?.dispose()
    playground = createRuntime(options)
    const current = playground
    current.on(PlaygroundEventType.PROGRESS, handleProgress)
    const isCurrent = () => playground === current && !current.disposed
    current.on(PlaygroundEventType.ERROR, ({ error }) => {
      if (isCurrent()) failPlayground(error)
    })

    try {
      const starting = current.start()
      const [session] = await Promise.all([starting, current.waitUntilReady()])
      if (!isCurrent()) return
      instanceId.value = session.id
      instances.value = listSessions()

      installedApps.value = current.listInstalledApps()

      const params = new URLSearchParams(window.location.search)

      const result = await processFlags(params, {
        playground: current,
        signal: current.abortController.signal,
        instanceId: instanceId.value,
        installApp: appId => apps.installBootApp(appId, current),
      })

      if (!isCurrent()) return
      installedApps.value = current.listInstalledApps()
      address.value = result.initialPath

      runtimeState.value = 'ready'
      frameSrc.value = frameUrl(address.value)
      startAddressSync()

      // Clear boot flags from URL so they aren't reapplied when switching playgrounds
      if (window.location.search) {
        window.history.replaceState(null, '', window.location.pathname)
      }

      if (session.freshSession && !result.autoLogin && !result.skipOnboarding) {
        showIntroDialog.value = true
      }
    } catch (error) {
      if (playground !== current || error?.name === 'AbortError') return
      failPlayground(error)
    }
  }

  function failPlayground(error) {
    stopPlayground()
    bootError.value = error.message || 'Playground initialization failed.'
    runtimeState.value = 'failed'
  }

  function stopPlayground() {
    runtimeState.value = 'stopping'
    playground?.dispose()
    frame.stopAddressSync()
    runtimeState.value = 'idle'
  }
  onBeforeUnmount(stopPlayground)
  return { runtimeState, ready, booting, bootError, bootSteps, instanceId, instances, showIntroDialog,
    initPlayground, stopPlayground, failPlayground, ...frame, ...apps }
}
