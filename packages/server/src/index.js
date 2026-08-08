// Frappe Playground — Pyodide server worker entry point
import { FRAPPE_MOCKS_SOURCE, WSGI_SERVER_SOURCE } from '/generated/python-sources.js?v=1'
import {
  ProtocolMessageType,
  RuntimeStage,
  createRuntimeErrorMessage,
  createRuntimeLogMessage,
  createRuntimeReadyMessage,
  isProtocolMessage,
} from '/protocol/messages.js?v=2'
import {
  createBackendResponse,
  readBackendRequest,
} from '/protocol/request.js?v=2'
import {
  installRuntimeFilesystem,
  writeSiteFiles,
} from '/server/filesystem.js?v=1'
import {
  BrowserStateStore,
  checkpointDatabase,
  initializeSiteDatabase,
} from '/server/persistence.js?v=1'
import {
  PythonBridge,
  SerialRequestExecutor,
} from '/server/request-handler.js?v=1'
import { initializePyodide } from '/server/boot.js?v=1'
import { BENCH_DIRECTORIES, PYTHON_PACKAGES, SITE_CONFIG } from './config.js'

const origin = self.location.origin
const storageEndpoint = `${origin}/storage`
const assetsEndpoint = `${origin}/assets`
const environmentRoot = '/home/pyodide/frappe_env'
const siteRoot = '/home/pyodide/bench/sites'
const siteName = 'site1'
const siteDbPath = `${siteRoot}/${siteName}/db/${siteName}.db`
const assetsJsonPath = `${siteRoot}/assets/assets.json`
const staticSiteFiles = {
  [`${siteRoot}/apps.txt`]: 'frappe\n',
  [`${siteRoot}/currentsite.txt`]: `${siteName}\n`,
  [`${siteRoot}/${siteName}/site_config.json`]: JSON.stringify(SITE_CONFIG),
}

const urlParams = new URLSearchParams(self.location.search)
const instanceScope = urlParams.get('scope') || 'default'
let freshSession = urlParams.get('fresh') === 'true'
let pyodide = null
let bootPromise = null

const stateStore = new BrowserStateStore({
  indexedDB,
  scope: instanceScope,
  getFs: () => pyodide.FS,
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
  self.postMessage(createRuntimeReadyMessage())
  return bridge
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
    handleRequest: request => bridge.handleRequest(request),
    persist: async () => {
      await checkpointDatabase(pyodide, siteDbPath)
      await stateStore.save(siteDbPath, await bridge.exportCookieJar())
    },
  })
}

self.onmessage = async event => {
  if (!isProtocolMessage(event.data, ProtocolMessageType.INIT_CHANNEL)) return

  const serviceWorkerPort = event.ports[0]
  if (!bootPromise) {
    freshSession = event.data.payload.freshSession !== false
    bootPromise = bootPython()
  }

  try {
    const bridge = await bootPromise
    createRequestExecutor(bridge).attach(serviceWorkerPort)
    serviceWorkerPort.postMessage(createRuntimeReadyMessage())
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
