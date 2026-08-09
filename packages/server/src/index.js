// Frappe Playground — Pyodide server worker entry point
import { FRAPPE_MOCKS_SOURCE, WSGI_SERVER_SOURCE } from '/generated/python-sources.js'
import {
  ProtocolMessageType,
  RuntimeStage,
  createAppInstallResultMessage,
  createRuntimeErrorMessage,
  createRuntimeLogMessage,
  createRuntimeReadyMessage,
  isProtocolMessage,
} from '/protocol/messages.js'
import {
  createBackendResponse,
  readBackendRequest,
} from '/protocol/request.js'
import {
  installRuntimeFilesystem,
  writeSiteFiles,
} from '/server/filesystem.js'
import {
  BrowserStateStore,
  checkpointDatabase,
  initializeSiteDatabase,
} from '/server/persistence.js'
import {
  PythonBridge,
  SerialRequestExecutor,
} from '/server/request-handler.js'
import { initializePyodide } from '/server/boot.js'
import {
  installCatalogApp,
  loadAppCatalog,
  prepareInstalledApps,
  writeInstalledApps,
} from '/server/app-installer.js'
import { BENCH_DIRECTORIES, PYTHON_PACKAGES, SITE_CONFIG } from './config.js'

const origin = self.location.origin
const storageEndpoint = `${origin}/storage`
const assetsEndpoint = `${origin}/assets`
const environmentRoot = '/home/pyodide/frappe_env'
const siteRoot = '/home/pyodide/bench/sites'
const siteName = 'site1'
const siteDbPath = `${siteRoot}/${siteName}/db/${siteName}.db`
const siteFileRoots = [
  `${siteRoot}/${siteName}/public/files`,
  `${siteRoot}/${siteName}/private/files`,
]
const assetsJsonPath = `${siteRoot}/assets/assets.json`
const appsFile = `${siteRoot}/apps.txt`
const staticSiteFiles = {
  [`${siteRoot}/currentsite.txt`]: `${siteName}\n`,
  [`${siteRoot}/${siteName}/site_config.json`]: JSON.stringify(SITE_CONFIG),
}

const urlParams = new URLSearchParams(self.location.search)
const instanceScope = urlParams.get('scope') || 'default'
let freshSession = urlParams.get('fresh') === 'true'
let pyodide = null
let bootPromise = null
let appCatalog = null
let appInstallationPromise = Promise.resolve()

const stateStore = new BrowserStateStore({
  indexedDB,
  scope: instanceScope,
  getFs: () => pyodide.FS,
  siteFileRoots,
})

function logRuntime(message, stage, status = 'active') {
  self.postMessage(createRuntimeLogMessage(message, stage, status))
}

async function bootPython() {
  pyodide = await initializePyodide({
    globalScope: self,
    fetchFn: (...args) => fetch(...args),
    pythonPackages: PYTHON_PACKAGES,
    log: message => logRuntime(message, RuntimeStage.PYTHON),
  })

  const assetsText = await installRuntimeFilesystem({
    pyodide,
    fetchFn: (...args) => fetch(...args),
    assetsEndpoint,
    storageEndpoint,
    environmentRoot,
    benchDirectories: BENCH_DIRECTORIES,
    log: message => logRuntime(message, RuntimeStage.RUNTIME),
  })

  await initializeSiteDatabase({
    pyodide,
    fetchFn: (...args) => fetch(...args),
    stateStore,
    dbPath: siteDbPath,
    storageEndpoint,
    freshSession,
    log: message => logRuntime(message, RuntimeStage.DATABASE),
  })

  pyodide.FS.writeFile(assetsJsonPath, assetsText)
  writeSiteFiles(pyodide.FS, staticSiteFiles)
  appCatalog = await loadAppCatalog({ fetchFn: (...args) => fetch(...args) })
  await prepareInstalledApps({
    pyodide,
    fetchFn: (...args) => fetch(...args),
    catalog: appCatalog,
    appIds: stateStore.installedApps,
    environmentRoot,
    appsFile,
    cryptoApi: self.crypto,
  })

  logRuntime('Configuring Python environment...', RuntimeStage.FRAPPE)
  const bridge = new PythonBridge({
    pyodide,
    mocksSource: FRAPPE_MOCKS_SOURCE,
    wsgiSource: WSGI_SERVER_SOURCE,
    cookieJarJson: stateStore.cookieJarJson,
  })
  await bridge.configure()

  logRuntime('Frappe booted successfully!', RuntimeStage.FRAPPE, 'done')
  console.log('[WORKER] Pyodide server boot complete.')
  return bridge
}

async function installApp(appId) {
  const bridge = await bootPromise
  await checkpointDatabase(pyodide, siteDbPath)
  const databaseBackup = pyodide.FS.readFile(siteDbPath).slice()
  const installedAppsBackup = [...stateStore.installedApps]
  try {
    stateStore.installedApps = await installCatalogApp({
      pyodide,
      fetchFn: (...args) => fetch(...args),
      catalog: appCatalog,
      appId,
      installedAppIds: stateStore.installedApps,
      environmentRoot,
      appsFile,
      cryptoApi: self.crypto,
    })
    await checkpointDatabase(pyodide, siteDbPath)
    await stateStore.save(siteDbPath, await bridge.exportCookieJar(), stateStore.installedApps)
  } catch (error) {
    stateStore.installedApps = installedAppsBackup
    pyodide.FS.writeFile(siteDbPath, databaseBackup)
    for (const suffix of ['-wal', '-shm']) {
      try {
        pyodide.FS.unlink(`${siteDbPath}${suffix}`)
      } catch (_) {
        // The failed install may not have created a SQLite sidecar.
      }
    }
    writeInstalledApps(pyodide.FS, appsFile, installedAppsBackup)
    throw error
  }
}

function handleAppInstall(message) {
  const { requestId, appId } = message.payload
  appInstallationPromise = appInstallationPromise.then(async () => {
    try {
      await installApp(appId)
      self.postMessage(createAppInstallResultMessage(requestId, appId, { installed: true }))
    } catch (error) {
      console.error(`[Worker] Failed to install app ${appId}:`, error)
      self.postMessage(createAppInstallResultMessage(requestId, appId, {
        installed: false,
        error: error?.message || `Failed to install ${appId}.`,
      }))
    }
  })
}

function createRequestExecutor(bridge) {
  return new SerialRequestExecutor({
    decodeRequest: readBackendRequest,
    encodeResponse: createBackendResponse,
    encodeError: error => createBackendResponse({
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
      body: `Worker error: ${error.message}\n${error.stack || ''}`,
    }),
    handleRequest: async request => {
      await appInstallationPromise
      return bridge.handleRequest(request)
    },
    persist: async () => {
      await checkpointDatabase(pyodide, siteDbPath)
      await stateStore.save(siteDbPath, await bridge.exportCookieJar())
    },
  })
}

self.onmessage = async event => {
  if (isProtocolMessage(event.data, ProtocolMessageType.APP_INSTALL)) {
    handleAppInstall(event.data)
    return
  }
  if (!isProtocolMessage(event.data, ProtocolMessageType.INIT_CHANNEL)) return

  const serviceWorkerPort = event.ports[0]
  if (!bootPromise) {
    freshSession = event.data.payload.freshSession !== false
    bootPromise = bootPython()
  }

  try {
    const bridge = await bootPromise
    createRequestExecutor(bridge).attach(serviceWorkerPort)
    const readyMessage = createRuntimeReadyMessage({
      installedApps: stateStore.installedApps,
    })
    serviceWorkerPort.postMessage(readyMessage)
    self.postMessage(readyMessage)
  } catch (error) {
    bootPromise = null
    console.error('Failed to boot Pyodide:', error)
    self.postMessage(createRuntimeErrorMessage(
      error?.message
        ? `Frappe runtime failed to start: ${error.message}`
        : 'Frappe runtime failed to start.',
    ))
  }
}
