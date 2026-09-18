import { access, mkdtemp, rename, rm } from 'node:fs/promises'
import path from 'node:path'

export async function replaceDirectory(destination, build) {
  const temporary = await mkdtemp(path.join(path.dirname(destination), '.runtime-build-'))
  const staged = path.join(temporary, 'staged')
  const backup = path.join(temporary, 'previous')
  let moved = false
  let promoted = false
  try {
    await build(staged)
    let exists = false
    try { await access(destination); exists = true } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (exists) { await rename(destination, backup); moved = true }
    try {
      await rename(staged, destination)
      promoted = true
    } catch (error) {
      if (moved) { await rename(backup, destination); moved = false }
      throw error
    }
  } finally {
    // Preserve the backup if rollback itself failed.
    if (!moved || promoted) await rm(temporary, { recursive: true, force: true })
  }
}
