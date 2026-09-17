import { readdir } from 'node:fs/promises'
import path from 'node:path'

export async function listFrappeLocaleArtifacts(artifactsDir) {
  const root = path.join(artifactsDir, 'assets/locale')
  const artifacts = []
  for (const locale of await readdir(root, { withFileTypes: true })) {
    if (!locale.isDirectory() || !/^[A-Za-z0-9_]+$/.test(locale.name)) continue
    try {
      const files = await readdir(path.join(root, locale.name, 'LC_MESSAGES'))
      if (files.includes('frappe.mo')) artifacts.push(`assets/locale/${locale.name}/LC_MESSAGES/frappe.mo`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return artifacts.sort()
}
