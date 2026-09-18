import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { authoredPublicFiles, projectRoot, publishedSource, runtimeDirectories } from './publication.mjs'

const dist = path.join(projectRoot, 'dist')
await access(path.join(dist, 'index.html'))
await access(path.join(projectRoot, 'artifacts/runtime/manifest.json'))
const files = authoredPublicFiles()
const destinations = new Set([...files.keys()].map(name => name.split('/')[0]))
for (const [name] of runtimeDirectories) destinations.add(name)
destinations.add('python')
for (const name of destinations) await rm(path.join(dist, name), { recursive: true, force: true })
for (const [destination, source] of runtimeDirectories) {
  const target = path.join(dist, destination)
  const input = path.join(projectRoot, source)
  if (destination === 'storage') {
    await mkdir(target, { recursive: true })
    for (const name of await readdir(input)) {
      if (name !== 'apps' && name !== 'assets') await cp(path.join(input, name), path.join(target, name), { recursive: true })
    }
  } else await cp(input, target, { recursive: true })
}
for (const [destination, source] of files) {
  const target = path.join(dist, destination)
  const input = path.join(projectRoot, source)
  await mkdir(path.dirname(target), { recursive: true })
  if (source.endsWith('.js')) await writeFile(target, publishedSource(await readFile(input, 'utf8')))
  else await cp(input, target)
}
console.log('Runtime publication assembled.')
