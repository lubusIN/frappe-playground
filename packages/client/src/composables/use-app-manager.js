import { ref } from 'vue'
import { loadAppCatalog } from '../playground/apps.js'

export function useAppManager(getPlayground, {
  loadCatalog = loadAppCatalog,
  refreshView = () => {},
} = {}) {
  const showAppManager = ref(false)
  const availableApps = ref([])
  const installedApps = ref([])
  const appCatalogLoading = ref(false)
  const appCatalogError = ref('')
  const appInstallError = ref('')
  const installingAppId = ref('')
  const uninstallingAppId = ref('')
  let catalogPromise

  function ensureCatalog() {
    if (catalogPromise) return catalogPromise
    appCatalogLoading.value = true
    appCatalogError.value = ''
    catalogPromise = Promise.resolve().then(loadCatalog).then(catalog => {
      availableApps.value = catalog.apps
      return catalog
    }).catch(error => {
      catalogPromise = null
      appCatalogError.value = error.message || 'Could not load the app catalog.'
      throw error
    }).finally(() => { appCatalogLoading.value = false })
    return catalogPromise
  }

  async function openAppManager() {
    showAppManager.value = true
    appInstallError.value = ''
    installedApps.value = getPlayground()?.listInstalledApps() || []
    try {
      await ensureCatalog()
    } catch (_) {
      // Displayed by the dialog.
    }
  }

  async function mutateApp(appId, action) {
    const playground = getPlayground()
    if (!playground || installingAppId.value || uninstallingAppId.value) return
    const activeId = action === 'installApp' ? installingAppId : uninstallingAppId
    activeId.value = appId
    appInstallError.value = ''
    try {
      await playground[action](appId)
      if (getPlayground() !== playground || playground.disposed) return
      installedApps.value = playground.listInstalledApps()
      await refreshView()
      if (getPlayground() === playground && !playground.disposed) showAppManager.value = false
    } catch (error) {
      if (getPlayground() === playground && !playground.disposed) {
        appInstallError.value = error.message
      }
    } finally {
      if (getPlayground() === playground) activeId.value = ''
    }
  }

  async function installBootApp(appId, playground) {
    // The ready worker already owns the validated installation catalog.
    if (playground.disposed || getPlayground() !== playground) {
      throw new DOMException('Boot cancelled', 'AbortError')
    }
    installingAppId.value = appId
    try {
      await playground.installApp(appId)
    } catch (error) {
      throw new Error(`Failed to install app '${appId}': ${error.message}`)
    } finally {
      if (getPlayground() === playground) installingAppId.value = ''
    }
  }

  function resetAppState() {
    showAppManager.value = false
    installedApps.value = []
    installingAppId.value = ''
    uninstallingAppId.value = ''
    appInstallError.value = ''
  }

  return {
    resetAppState, showAppManager, availableApps, installedApps, appCatalogLoading, appCatalogError,
    appInstallError, installingAppId, uninstallingAppId, ensureCatalog, openAppManager,
    retryAppCatalog: openAppManager, installBootApp,
    installApp: appId => mutateApp(appId, 'installApp'),
    uninstallApp: appId => mutateApp(appId, 'uninstallApp'),
  }
}
