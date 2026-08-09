import { createHash } from 'node:crypto'
import {
  validateAppCatalog,
  validateAppId,
} from '../packages/protocol/src/app-catalog.js'

export { validateAppCatalog, validateAppId }

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

export function catalogFingerprint(catalog) {
  return createHash('sha256').update(canonicalJson(catalog)).digest('hex')
}

export function assertGeneratedCatalogMatches(authoredCatalog, generatedCatalog) {
  validateAppCatalog(authoredCatalog)
  validateAppCatalog(generatedCatalog, { generated: true })
  if (generatedCatalog.sourceCatalogSha256 !== catalogFingerprint(authoredCatalog)) {
    throw new Error('Generated app artifacts are stale; run npm run build:runtime')
  }
  return generatedCatalog
}
