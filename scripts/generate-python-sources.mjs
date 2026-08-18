import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pythonDir = path.join(projectRoot, 'runtime/python')
const outputDir = path.join(projectRoot, 'artifacts/generated')
const [
  frappeMocksSource,
  wsgiServerSource,
  sqliteCompatSource,
  rapidfuzzCompatSource,
] = await Promise.all([
  readFile(path.join(pythonDir, 'frappe_mocks.py'), 'utf8'),
  readFile(path.join(pythonDir, 'wsgi_server.py'), 'utf8'),
  readFile(path.join(pythonDir, 'sqlite_compat.py'), 'utf8'),
  readFile(path.join(pythonDir, 'rapidfuzz_compat.py'), 'utf8'),
])

await mkdir(outputDir, { recursive: true })
await writeFile(path.join(outputDir, 'package.json'), '{"private":true,"type":"module"}\n')
await writeFile(
  path.join(outputDir, 'python-sources.js'),
  [
    '// Generated from runtime/python. Do not edit.',
    `export const FRAPPE_MOCKS_SOURCE = ${JSON.stringify(frappeMocksSource)}`,
    `export const WSGI_SERVER_SOURCE = ${JSON.stringify(wsgiServerSource)}`,
    `export const SQLITE_COMPAT_SOURCE = ${JSON.stringify(sqliteCompatSource)}`,
    `export const RAPIDFUZZ_COMPAT_SOURCE = ${JSON.stringify(rapidfuzzCompatSource)}`,
    '',
  ].join('\n'),
)
