import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [artifactsDir, frappeVersion] = process.argv.slice(2)

if (!artifactsDir || !frappeVersion) {
  console.error('Usage: write-runtime-manifest.mjs <artifacts-dir> <frappe-version>')
  process.exit(1)
}

const artifactNames = ['frappe_runtime.tar.gz', 'site1.db', 'assets/assets.json']
const files = {}

for (const name of artifactNames) {
  const filePath = path.join(artifactsDir, name)
  const [contents, metadata] = await Promise.all([readFile(filePath), stat(filePath)])
  files[name] = {
    bytes: metadata.size,
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
}

const manifest = {
  schemaVersion: 1,
  frappeVersion,
  files,
}

await writeFile(
  path.join(artifactsDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
