// Frappe reads compiled catalogs synchronously from sites/assets/locale.
// Lazy files defer their bytes until Python selects that language, including
// parent-language fallback, without duplicating Frappe's language resolution.
export function mountFrappeTranslations({ fs, manifest, assetsEndpoint }) {
  for (const [path, metadata] of Object.entries(manifest.files || {})) {
    const match = /^assets\/locale\/([A-Za-z0-9_]+)\/LC_MESSAGES\/frappe\.mo$/.exec(path)
    if (!match) continue
    const directory = `/home/pyodide/bench/sites/assets/locale/${match[1]}/LC_MESSAGES`
    fs.mkdirTree(directory)
    const url = `${assetsEndpoint}/${path.slice('assets/'.length)}?sha256=${metadata.sha256}`
    fs.createLazyFile(directory, 'frappe.mo', url, true, false)
  }
}
