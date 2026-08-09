import { validateAppCatalog, validateAppId } from '../../protocol/src/app-catalog.js'
import { fetchBinary, fetchOk } from './filesystem.js'

function bytesToHex(bytes) {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

export async function loadAppCatalog({ fetchFn, catalogUrl = '/apps/catalog.json' }) {
  const response = await fetchOk(fetchFn, catalogUrl)
  return validateAppCatalog(await response.json(), { generated: true })
}

export function appById(catalog, appId) {
  validateAppId(appId)
  const app = catalog.apps.find(entry => entry.id === appId)
  if (!app) throw new Error(`App is not available in this build: ${appId}`)
  return app
}

export async function verifyArchive(archive, expectedSha256, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error('Web Crypto is unavailable; app archive cannot be verified.')
  const digest = await cryptoApi.subtle.digest('SHA-256', archive)
  const actualSha256 = bytesToHex(new Uint8Array(digest))
  if (actualSha256 !== expectedSha256) {
    throw new Error('App archive integrity check failed.')
  }
}

export function writeInstalledApps(fs, appsFile, appIds = []) {
  const uniqueIds = [...new Set(['frappe', ...appIds.map(validateAppId)])]
  fs.writeFile(appsFile, `${uniqueIds.join('\n')}\n`)
}

export async function prepareApp({
  pyodide,
  fetchFn,
  app,
  environmentRoot,
  cryptoApi = globalThis.crypto,
}) {
  if (app.pythonDependencies.length) {
    await pyodide.pyimport('micropip').install(app.pythonDependencies, { keep_going: true })
  }
  const archive = await fetchBinary(fetchFn, `/${app.archive}`)
  if (archive.byteLength !== app.archiveBytes) {
    throw new Error(`App archive size check failed: ${app.id}`)
  }
  await verifyArchive(archive, app.archiveSha256, cryptoApi)
  pyodide.unpackArchive(archive, 'zip', { extractDir: environmentRoot })
}

export async function prepareInstalledApps({
  pyodide,
  fetchFn,
  catalog,
  appIds,
  environmentRoot,
  appsFile,
  cryptoApi = globalThis.crypto,
}) {
  for (const appId of appIds) {
    await prepareApp({
      pyodide,
      fetchFn,
      app: appById(catalog, appId),
      environmentRoot,
      cryptoApi,
    })
  }
  writeInstalledApps(pyodide.FS, appsFile, appIds)
}

export async function installFrappeApp(pyodide, appId) {
  validateAppId(appId)
  pyodide.globals.set('playground_app_id', appId)
  try {
    await pyodide.runPythonAsync(`
import frappe
from frappe.installer import install_app

frappe.init(site="site1", sites_path="/home/pyodide/bench/sites")
frappe.connect()
try:
    if playground_app_id not in frappe.get_installed_apps():
        install_app(playground_app_id)
        frappe.db.commit()
finally:
    frappe.destroy()
`)
  } finally {
    pyodide.globals.delete('playground_app_id')
  }
}

export async function installCatalogApp({
  pyodide,
  fetchFn,
  catalog,
  appId,
  installedAppIds,
  environmentRoot,
  appsFile,
  cryptoApi = globalThis.crypto,
}) {
  validateAppId(appId)
  if (installedAppIds.includes(appId)) return [...installedAppIds]

  await prepareApp({
    pyodide,
    fetchFn,
    app: appById(catalog, appId),
    environmentRoot,
    cryptoApi,
  })
  const nextAppIds = [...installedAppIds, appId]
  writeInstalledApps(pyodide.FS, appsFile, nextAppIds)
  await installFrappeApp(pyodide, appId)
  return nextAppIds
}
