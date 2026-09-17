import { mkdir, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { projectRoot } from './publication.mjs'
import { replaceDirectory } from './transactional-directory.mjs'
import { verifyBuild } from './verify-build.mjs'

const declared = JSON.parse(await readFile(path.join(projectRoot, 'runtime/frappe-version.json'), 'utf8'))
const version = process.env.FRAPPE_VERSION || declared.frappeVersion
function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status}).`)
}
await mkdir(path.join(projectRoot, 'artifacts'), { recursive: true })
await replaceDirectory(path.join(projectRoot, 'artifacts/runtime'), async staged => {
  await mkdir(staged)
  run('docker', ['build', '--build-arg', `FRAPPE_VERSION=${version}`, '-t', 'frappe-playground', '-f', 'runtime/build/Dockerfile', '.'])
  run('docker', ['run', '--rm', '-v', `${staged}:/output`, 'frappe-playground:latest'])
  run('tar', ['-xzf', path.join(staged, 'assets.tar.gz'), '-C', staged])
  await rm(path.join(staged, 'assets.tar.gz'))
  run(process.execPath, ['scripts/write-runtime-manifest.mjs', staged, version])
  await verifyBuild({ artifactsDir: staged, runtimeOnly: true })
  run('bash', ['scripts/check-limits.sh', staged])
})
console.log('Runtime build verified and published.')
