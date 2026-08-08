export function hashString(value) {
  let hash = 5381
  for (let i = 0; i < value.length; i++) hash = (hash * 33) ^ value.charCodeAt(i)
  return (hash >>> 0).toString(16)
}

export async function fetchOk(fetchFn, url) {
  const response = await fetchFn(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  return response
}

export async function fetchBinary(fetchFn, url) {
  return new Uint8Array(await (await fetchOk(fetchFn, url)).arrayBuffer())
}

export function ensureDirectories(fs, paths) {
  for (const directory of paths) {
    try {
      fs.mkdir(directory)
    } catch (_) {
      // Directory already exists.
    }
  }
}

function syncFilesystem(fs, populate) {
  return new Promise((resolve, reject) => {
    fs.syncfs(populate, error => error ? reject(error) : resolve())
  })
}

export async function installRuntimeFilesystem({
  pyodide,
  fetchFn,
  assetsEndpoint,
  storageEndpoint,
  environmentRoot,
  benchDirectories,
  log,
  logger = console,
  now = Date.now,
}) {
  log('Fetching Frappe runtime...')
  const assetsResponse = await fetchFn(`${assetsEndpoint}/assets.json?t=${now()}`)
  if (!assetsResponse.ok) throw new Error('Failed to fetch the Frappe assets manifest.')
  const assetsText = await assetsResponse.text()
  const currentHash = hashString(assetsText)

  log('Mounting virtual filesystem...')
  ensureDirectories(pyodide.FS, [environmentRoot])
  pyodide.FS.mount(pyodide.FS.filesystems.IDBFS, {}, environmentRoot)
  await syncFilesystem(pyodide.FS, true)

  const versionPath = `${environmentRoot}/version.txt`
  let needsExtract = true
  try {
    const cachedHash = pyodide.FS.readFile(versionPath, { encoding: 'utf8' })
    if (cachedHash === currentHash) {
      needsExtract = false
      log('Restored virtual environment from IDBFS!')
      logger.log('[Worker] Restored virtual environment from IDBFS. Skipping extraction.')
    } else {
      logger.log(`[Worker] Runtime hash changed: ${cachedHash} -> ${currentHash}`)
    }
  } catch (_) {
    logger.log('[Worker] No valid runtime version found in IDBFS.')
  }

  if (needsExtract) {
    log('Extracting fresh virtual filesystem...')
    const archive = await fetchBinary(fetchFn, `${storageEndpoint}/frappe_runtime.tar.gz`)
    pyodide.unpackArchive(archive, 'gztar', { extractDir: environmentRoot })
    pyodide.FS.writeFile(versionPath, currentHash)
    await syncFilesystem(pyodide.FS, false)
  }

  ensureDirectories(pyodide.FS, benchDirectories)
  return assetsText
}

export function writeSiteFiles(fs, files) {
  for (const [filePath, contents] of Object.entries(files)) fs.writeFile(filePath, contents)
}
