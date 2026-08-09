import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAppCatalog } from './app-catalog.mjs'

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const catalogPath = process.argv[2] || path.join(projectRoot, 'runtime/apps/catalog.json')
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))

validateAppCatalog(catalog)
console.log(`App catalog verified: ${catalog.apps.length} app(s).`)
