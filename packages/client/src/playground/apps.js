import { validateAppCatalog } from '../../../protocol/src/app-catalog.js'

export async function loadAppCatalog({
  fetchFn = globalThis.fetch,
  catalogUrl = '/apps/catalog.json',
} = {}) {
  const response = await fetchFn(catalogUrl)
  if (!response.ok) {
    throw new Error(`Could not load the app catalog (${response.status}).`)
  }
  return validateAppCatalog(await response.json(), { generated: true })
}
