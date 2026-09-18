import { listFrappeLocaleArtifacts } from './runtime-locales.mjs'
import { authoredPublicFiles, runtimePublishPath } from './publication.mjs'
import { createHash } from 'node:crypto'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertGeneratedCatalogMatches,
} from './app-catalog.mjs'

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const defaultArtifactsDir = path.join(projectRoot, 'artifacts/runtime')
const defaultDistDir = path.join(projectRoot, 'dist')
const defaultAuthoredCatalogPath = path.join(projectRoot, 'runtime/apps/catalog.json')

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
  authoredCatalogPath = defaultAuthoredCatalogPath,
  runtimeOnly = false,
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
    const authoredCatalog = JSON.parse(await readFile(authoredCatalogPath, 'utf8'))
    assertGeneratedCatalogMatches(authoredCatalog, appCatalog)
  } catch (error) {
    errors.push(`Invalid generated app catalog: ${error.message}`)
  }

  let localeArtifacts = []
  try {
    const publishedLocales = await listFrappeLocaleArtifacts(artifactsDir)
    const declaredLocales = Object.keys(manifest.files || {}).filter(
      name => /^assets\/locale\/[A-Za-z0-9_]+\/LC_MESSAGES\/frappe\.mo$/.test(name),
    )
    localeArtifacts = [...new Set([...publishedLocales, ...declaredLocales])]
  } catch (error) {
    errors.push(`Cannot inventory compiled Frappe translations: ${error.message}`)
  }
  if (!localeArtifacts.length) errors.push('Runtime manifest must include compiled Frappe translations')
  for (const name of localeArtifacts) {
    const file = path.join(artifactsDir, name)
    if (await exists(file)) {
      const bytes = await readFile(file)
      if (bytes.length < 28 || ![0x950412de, 0xde120495].includes(bytes.readUInt32LE(0))) {
        errors.push(`Invalid compiled translation catalog: ${name}`)
      }
    }
  }

  const publishPaths = Object.fromEntries([
    'frappe_runtime.tar.gz', 'site1.db', 'assets/assets.json', 'apps/catalog.json',
    ...(appCatalog?.apps || []).map(app => app.archive),
    ...localeArtifacts,
  ].map(name => [name, runtimePublishPath(name)]))
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
    if (!await exists(artifactPath) || (!runtimeOnly && !await exists(publishPath))) {
      errors.push(`Missing runtime artifact or publish copy: ${artifactName}`)
      continue
    }
    const artifactStat = await stat(artifactPath)
    if (artifactStat.size !== metadata.bytes) {
      errors.push(`Runtime artifact size mismatch: ${artifactName}`)
    }
    const [artifactHash, publishHash] = await Promise.all([
      sha256(artifactPath),
      runtimeOnly ? null : sha256(publishPath),
    ])
    if (artifactHash !== metadata.sha256) errors.push(`Runtime artifact hash mismatch: ${artifactName}`)
    if (!runtimeOnly && publishHash !== metadata.sha256) errors.push(`Published artifact hash mismatch: ${publishName}`)
  }

  if (runtimeOnly) {
    if (errors.length) throw new Error(`Runtime verification failed:\n- ${errors.join('\n- ')}`)
    return { frappeVersion: manifest.frappeVersion }
  }

  const requiredFiles = ['index.html', 'docs/index.html', 'apps/catalog.json', ...authoredPublicFiles().keys()]
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
