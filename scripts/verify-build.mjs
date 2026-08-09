import { createHash } from 'node:crypto'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAppCatalog } from './app-catalog.mjs'

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const defaultArtifactsDir = path.join(projectRoot, 'artifacts/runtime')
const defaultDistDir = path.join(projectRoot, 'dist')

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch (_) {
    return false
  }
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

async function listJavaScriptFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listJavaScriptFiles(entryPath))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(entryPath)
  }
  return files
}

function localModuleSpecifiers(source) {
  const specifiers = []
  const staticImportPattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g
  const dynamicImportPattern = /import\s*\(\s*["']([^"']+)["']\s*\)/g

  for (const pattern of [staticImportPattern, dynamicImportPattern]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith('/') || match[1].startsWith('.')) specifiers.push(match[1])
    }
  }
  return specifiers
}

function resolvePublishedImport(distDir, importer, specifier) {
  const target = specifier.startsWith('/')
    ? path.resolve(distDir, `.${new URL(specifier, 'https://playground.local').pathname}`)
    : path.resolve(path.dirname(importer), decodeURIComponent(specifier.split(/[?#]/, 1)[0]))
  const relativeTarget = path.relative(distDir, target)

  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) return null
  return target
}

export async function verifyBuild({
  artifactsDir = defaultArtifactsDir,
  distDir = defaultDistDir,
} = {}) {
  const errors = []
  const manifestPath = path.join(artifactsDir, 'manifest.json')
  if (!await exists(manifestPath)) throw new Error(`Missing runtime manifest: ${manifestPath}`)

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1) errors.push('Runtime manifest schemaVersion must be 1')
  if (typeof manifest.frappeVersion !== 'string' || !manifest.frappeVersion) {
    errors.push('Runtime manifest must declare frappeVersion')
  }

  let appCatalog = null
  try {
    appCatalog = JSON.parse(await readFile(path.join(artifactsDir, 'apps/catalog.json'), 'utf8'))
    validateAppCatalog(appCatalog, { generated: true })
  } catch (error) {
    errors.push(`Invalid generated app catalog: ${error.message}`)
  }

  const publishPaths = {
    'frappe_runtime.tar.gz': 'storage/frappe_runtime.tar.gz',
    'site1.db': 'storage/site1.db',
    'assets/assets.json': 'assets/assets.json',
    'apps/catalog.json': 'apps/catalog.json',
  }
  for (const app of appCatalog?.apps || []) publishPaths[app.archive] = app.archive
  for (const app of appCatalog?.apps || []) {
    const archiveMetadata = manifest.files?.[app.archive]
    if (archiveMetadata?.bytes !== app.archiveBytes) {
      errors.push(`App catalog size mismatch: ${app.archive}`)
    }
    if (archiveMetadata?.sha256 !== app.archiveSha256) {
      errors.push(`App catalog hash mismatch: ${app.archive}`)
    }
  }
  for (const [artifactName, publishName] of Object.entries(publishPaths)) {
    const metadata = manifest.files?.[artifactName]
    const artifactPath = path.join(artifactsDir, artifactName)
    const publishPath = path.join(distDir, publishName)
    if (!metadata) {
      errors.push(`Runtime manifest is missing ${artifactName}`)
      continue
    }
    if (!await exists(artifactPath) || !await exists(publishPath)) {
      errors.push(`Missing runtime artifact or publish copy: ${artifactName}`)
      continue
    }
    const artifactStat = await stat(artifactPath)
    if (artifactStat.size !== metadata.bytes) {
      errors.push(`Runtime artifact size mismatch: ${artifactName}`)
    }
    const [artifactHash, publishHash] = await Promise.all([
      sha256(artifactPath),
      sha256(publishPath),
    ])
    if (artifactHash !== metadata.sha256) errors.push(`Runtime artifact hash mismatch: ${artifactName}`)
    if (publishHash !== metadata.sha256) errors.push(`Published artifact hash mismatch: ${publishName}`)
  }

  const requiredFiles = [
    'index.html',
    'apps/catalog.json',
    'sw.js',
    'worker.js',
    'config.js',
    'protocol/app-catalog.js',
    'protocol/messages.js',
    'protocol/request.js',
    'protocol/scope-url.js',
    'protocol/version.js',
    'runtime-config/packages.js',
    'runtime-config/site.js',
    'generated/python-sources.js',
    'service-worker/backend-proxy.js',
    'service-worker/cache.js',
    'service-worker/instance-registry.js',
    'service-worker/routing.js',
    'server/filesystem.js',
    'server/app-installer.js',
    'server/persistence.js',
    'server/request-handler.js',
    'server/boot.js',
  ]
  for (const file of requiredFiles) {
    if (!await exists(path.join(distDir, file))) errors.push(`Missing publish file: ${file}`)
  }
  if (await exists(path.join(distDir, 'python'))) {
    errors.push('Loose Python sources must not be present in dist/python')
  }
  if (await exists(path.join(distDir, '.stale-build-sentinel'))) {
    errors.push('Vite did not clean stale publish output')
  }

  const authoredRoots = [
    'sw.js',
    'worker.js',
    'config.js',
    'protocol',
    'runtime-config',
    'service-worker',
    'server',
  ]
  const javascriptFiles = []
  for (const root of authoredRoots) {
    const rootPath = path.join(distDir, root)
    if (!await exists(rootPath)) continue
    const metadata = await stat(rootPath)
    if (metadata.isDirectory()) javascriptFiles.push(...await listJavaScriptFiles(rootPath))
    else javascriptFiles.push(rootPath)
  }
  for (const file of javascriptFiles) {
    const source = await readFile(file, 'utf8')
    for (const specifier of localModuleSpecifiers(source)) {
      const target = resolvePublishedImport(distDir, file, specifier)
      if (!target) {
        errors.push(`${path.relative(distDir, file)} imports outside publish root: ${specifier}`)
      } else if (!await exists(target)) {
        errors.push(`${path.relative(distDir, file)} imports missing ${specifier}`)
      }
    }
  }

  if (errors.length) throw new Error(`Build verification failed:\n- ${errors.join('\n- ')}`)
  return {
    frappeVersion: manifest.frappeVersion,
    checkedFiles: requiredFiles.length,
    appCount: appCatalog?.apps.length || 0,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyBuild()
  console.log(
    `Build verified: Frappe ${result.frappeVersion}, ${result.appCount} catalog app(s), ${result.checkedFiles} required files, runtime hashes match.`,
  )
}
