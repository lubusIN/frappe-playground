import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const runtimeDirectories = [
  ['apps', 'artifacts/runtime/apps'],
  ['assets', 'artifacts/runtime/assets'],
  ['storage', 'artifacts/runtime'],
]

export function authoredPublicFiles() {
  const files = new Map([
    ['sw.js', 'packages/service-worker/src/index.js'],
    ['worker.js', 'packages/server/src/index.js'],
    ['config.js', 'packages/server/src/config.js'],
    ['service-worker/scope-bootstrap.js', 'artifacts/generated/scope-bootstrap.js'],
    ['generated/python-sources.js', 'artifacts/generated/python-sources.js'],
    ...['_headers', '_redirects', 'favicon.ico'].map(name => [name, `static/${name}`]),
  ])
  for (const [destination, source, excluded] of [
    ['protocol', 'packages/protocol/src', []],
    ['server', 'packages/server/src', ['index.js', 'config.js']],
    ['service-worker', 'packages/service-worker/src', ['index.js', 'scope-bootstrap.js']],
    ['runtime-config', 'runtime/config', []],
  ]) {
    for (const name of readdirSync(path.join(projectRoot, source))) {
      if (name.endsWith('.js') && !excluded.includes(name)) files.set(`${destination}/${name}`, `${source}/${name}`)
    }
  }
  return files
}

export function publishedSource(source) {
  return source.replace(/(['"])\.\.\/\.\.\/protocol\/src\//g, '$1/protocol/')
}

export function runtimePublishPath(artifact) {
  return artifact.startsWith('apps/') || artifact.startsWith('assets/') ? artifact : `storage/${artifact}`
}

const devPublicFiles = authoredPublicFiles()

export function resolveDevFile(pathname) {
  const relative = pathname.replace(/^\//, '')
  const authored = devPublicFiles.get(relative)
  if (authored) return path.join(projectRoot, authored)
  for (const [prefix, source] of runtimeDirectories) {
    if (!relative.startsWith(`${prefix}/`)) continue
    const directory = path.join(projectRoot, source)
    let decoded
    try { decoded = decodeURIComponent(relative.slice(prefix.length + 1)) } catch (_) { return null }
    const file = path.resolve(directory, decoded)
    if (file.startsWith(`${directory}${path.sep}`)) return file
  }
  return null
}
