import { onMounted, ref } from 'vue'
import { parseBootOptions } from '../playground/boot-options.js'
import {
  createInstanceSession,
  deleteInstanceData,
  listInstanceSessions,
  removeInstanceSession,
  renameInstanceSession,
  selectInstanceSession,
} from '../playground/session.js'

export function useInstanceManager({ instanceId, instances, initPlayground, stopPlayground, failPlayground }) {
  const instanceBusy = ref(false)
  const instanceError = ref('')
  const instanceManagerRef = ref(null)
  const showInstanceManager = ref(false)

  function createInstance(name) {
    if (instanceBusy.value) return
    const session = createInstanceSession({ name })
    instances.value = listInstanceSessions()
    showInstanceManager.value = false
    initPlayground({ session })
  }

  function selectInstance(id) {
    if (instanceBusy.value) return
    if (!id || id === instanceId.value) return
    showInstanceManager.value = false
    initPlayground({ instanceId: id })
  }

  function renameInstance({ id, name }) {
    if (instanceBusy.value) return
    const renamed = renameInstanceSession(id, name)
    if (renamed) instances.value = listInstanceSessions()
  }

  async function changeInstance(id, remove) {
    if (instanceBusy.value) return
    const isActive = id === instanceId.value
    const instance = instances.value.find(item => item.id === id)
    if (!instance) return
    instanceBusy.value = true
    instanceError.value = ''
    if (isActive) stopPlayground()
    try {
      await deleteInstanceData(id, {
        onBlocked: () => { instanceError.value = 'Close other tabs using this playground to finish removing its data.' },
      })
      instanceError.value = ''
      if (remove) instances.value = removeInstanceSession(id)
      if (isActive) {
        showInstanceManager.value = false
        if (!remove) await initPlayground({ session: { ...instance, freshSession: true } })
        else if (instances.value.length) await initPlayground({ instanceId: instances.value[0].id })
        else await initPlayground({ session: createInstanceSession({ name: 'My Playground' }) })
      }
    } catch (error) {
      instanceError.value = error.message || 'Unable to remove playground data.'
      if (isActive) failPlayground(error)
    } finally {
      instanceBusy.value = false
    }
  }
  const resetInstance = id => changeInstance(id, false)
  const deleteInstance = id => changeInstance(id, true)

  onMounted(() => {
    const params = new URLSearchParams(window.location.search)
    let sessionToBoot = undefined

    const { name, createInstance: createFromFlags } = parseBootOptions(params)
    if (name) {
      const existing = listInstanceSessions().find(i => i.name === name)
      if (existing) {
        sessionToBoot = selectInstanceSession(existing.id)
      } else {
        sessionToBoot = createInstanceSession({ name })
      }
    } else if (createFromFlags) {
      sessionToBoot = createInstanceSession()
    }

    if (sessionToBoot) {
      initPlayground({ session: sessionToBoot })
    } else {
      initPlayground()
    }
  })
  return { instanceManagerRef, showInstanceManager, instanceBusy, instanceError,
    createInstance, selectInstance, renameInstance, resetInstance, deleteInstance }
}
