#!/usr/bin/env node
// Mock ablation harness.
//
// Technical_Notes.md lists module mocks with no demonstrated need, and asks for
// each to be "tested for removal locally". This runs that experiment: remove one
// mock, rebuild, run the browser suite, record whether anything broke, restore.
//
// A mock whose removal keeps the suite green is dead code. A mock whose removal
// breaks the suite is a real Frappe portability constraint, and the captured
// failure is the reproduction an upstream report needs.
//
// Usage:
//   node scripts/ablate-mocks.mjs                 # every candidate
//   node scripts/ablate-mocks.mjs psycopg2 plaid  # named candidates
//   node scripts/ablate-mocks.mjs --list
//
// Requires artifacts/runtime/ to exist (npm run build:runtime) — the Docker
// runtime is NOT rebuilt per candidate, only the browser bundle.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const mocksPath = path.join(projectRoot, 'runtime/python/frappe_mocks.py')
const reportDir = path.join(projectRoot, 'artifacts/ablation')

// Candidates drawn from Technical_Notes.md "Mocks not shown to be needed",
// plus sentry_sdk, which shadows a package that packages.js actually installs.
const CANDIDATES = {
  psycopg2: { kind: 'block', note: 'Postgres driver; site runs SQLite' },
  pwd_grp: { kind: 'block', note: 'no pwd/grp imports found in bundled Frappe' },
  twilio: { kind: 'list', note: 'no direct import reference in bundled Frappe' },
  boto3: { kind: 'list', note: 'no direct import reference in bundled Frappe' },
  botocore: { kind: 'list', note: 'no direct import reference in bundled Frappe' },
  dropbox: { kind: 'list', note: 'no direct import reference in bundled Frappe' },
  braintree: { kind: 'list', note: 'no direct import reference in bundled Frappe' },
  stripe: { kind: 'list', note: 'no direct import reference in bundled Frappe' },
  plaid: { kind: 'list', note: 'no direct import in Frappe; IS an ERPNext dependency' },
  sentry_sdk: { kind: 'list', note: 'shadows the sentry-sdk that packages.js installs' },
  posthog: { kind: 'list', note: 'removed from Frappe entirely in v16.30.0 (telemetry now uses pulse)' },
}

function removeBlock(source, name) {
  const pattern = new RegExp(`# >>> ablatable: ${name}\\n[\\s\\S]*?# <<< ablatable: ${name}\\n?`, 'm')
  if (!pattern.test(source)) throw new Error(`ablation block not found: ${name}`)
  return source.replace(pattern, `# (ablated: ${name})\n`)
}

function removeListEntry(source, name) {
  const pattern = new RegExp(`^\\s*"${name}",\\n`, 'm')
  if (!pattern.test(source)) throw new Error(`ablation list entry not found: ${name}`)
  return source.replace(pattern, '')
}

function run(command, args) {
  execFileSync(command, args, { cwd: projectRoot, stdio: 'pipe', encoding: 'utf8' })
}

function attempt(label, fn) {
  try {
    fn()
    return { ok: true }
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim()
    return {
      ok: false,
      stage: label,
      // Keep the tail: Playwright and Vite put the actionable failure last.
      detail: output.split('\n').slice(-40).join('\n') || error.message,
    }
  }
}

const args = process.argv.slice(2)
if (args.includes('--list')) {
  for (const [name, meta] of Object.entries(CANDIDATES)) console.log(`${name.padEnd(12)} ${meta.note}`)
  process.exit(0)
}

const selected = args.length ? args : Object.keys(CANDIDATES)
for (const name of selected) {
  if (!CANDIDATES[name]) throw new Error(`unknown candidate: ${name}. Try --list`)
}

const original = readFileSync(mocksPath, 'utf8')
const results = []

console.log(`Ablating ${selected.length} mock(s). Baseline is NOT re-verified; run npm run test:e2e first.\n`)

try {
  for (const name of selected) {
    const { kind, note } = CANDIDATES[name]
    process.stdout.write(`── ${name} … `)
    const modified = kind === 'block' ? removeBlock(original, name) : removeListEntry(original, name)
    writeFileSync(mocksPath, modified)

    let outcome = attempt('build', () => run('npm', ['run', 'build']))
    if (outcome.ok) outcome = attempt('e2e', () => run('npm', ['run', 'test:e2e:chromium']))

    results.push({ mock: name, note, removable: outcome.ok, ...outcome })
    console.log(outcome.ok ? 'REMOVABLE (suite green)' : `REQUIRED (${outcome.stage} failed)`)
  }
} finally {
  writeFileSync(mocksPath, original)
  console.log('\nRestored original frappe_mocks.py.')
}

mkdirSync(reportDir, { recursive: true })
const reportPath = path.join(reportDir, 'report.json')
writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`)

console.log('\n┌─ Ablation results ─────────────────────────────────')
for (const result of results) {
  console.log(`│ ${result.removable ? '✓ remove ' : '✗ keep   '} ${result.mock.padEnd(12)} ${result.note}`)
}
console.log('└────────────────────────────────────────────────────')
console.log(`\nFull report: ${path.relative(projectRoot, reportPath)}`)
console.log('Mocks marked "remove" are dead code. Mocks marked "keep" have a captured')
console.log('failure in the report — that is the reproduction for an upstream issue.')
