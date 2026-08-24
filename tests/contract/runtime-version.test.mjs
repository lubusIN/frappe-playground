import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))

const read = name => readFile(path.join(projectRoot, name), 'utf8')

test('runtime version is declared in exactly one place', async () => {
  const declared = JSON.parse(await read('runtime/frappe-version.json')).frappeVersion
  assert.match(declared, /^v\d+\.\d+\.\d+$/, 'frappeVersion must be a pinned vX.Y.Z tag')

  const buildScript = await read('scripts/build.sh')
  assert.ok(
    buildScript.includes('runtime/frappe-version.json'),
    'scripts/build.sh must read the version file rather than hardcoding a tag',
  )
  const hardcoded = buildScript.match(/FRAPPE_VERSION="\$\{FRAPPE_VERSION:-v[\d.]+\}"/)
  assert.equal(hardcoded, null, 'scripts/build.sh must not hardcode a Frappe tag')
})

test('Dockerfile default matches the declared runtime version', async () => {
  const declared = JSON.parse(await read('runtime/frappe-version.json')).frappeVersion
  const dockerfile = await read('runtime/build/Dockerfile')
  const arg = dockerfile.match(/^ARG FRAPPE_VERSION=(\S+)/m)

  assert.ok(arg, 'Dockerfile must declare ARG FRAPPE_VERSION')
  assert.equal(
    arg[1],
    declared,
    `Dockerfile ARG (${arg[1]}) disagrees with runtime/frappe-version.json (${declared})`,
  )
})

test('Technical_Notes.md documents the version actually built', async () => {
  const declared = JSON.parse(await read('runtime/frappe-version.json')).frappeVersion
  const notes = await read('Technical_Notes.md')

  // Only the Reference Scope section describes the checked artifact. Version
  // numbers elsewhere are statements about when upstream behavior landed and
  // are deliberately not rewritten when the pinned runtime moves.
  const section = notes.match(/## Reference Scope\n([\s\S]*?)(?=\n## )/)
  assert.ok(section, 'Technical_Notes.md must keep a "## Reference Scope" section')

  const versions = new Set(
    [...section[1].matchAll(/\bv?(1[4-9]\.\d+\.\d+)\b/g)].map(match => match[1]),
  )
  assert.ok(versions.size > 0, 'Reference Scope must state the runtime version it describes')

  for (const version of versions) {
    assert.equal(
      `v${version}`,
      declared,
      `Technical_Notes.md Reference Scope references Frappe ${version} but the runtime `
        + `builds ${declared}. The notes describe a specific checked artifact, so a stale `
        + 'version invalidates them.',
    )
  }
})
