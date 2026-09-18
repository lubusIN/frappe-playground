import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(rootDir, 'docs/public/images')
const externalBaseUrl = process.env.DOCS_SCREENSHOT_URL
const port = Number(process.env.DOCS_SCREENSHOT_PORT || 4175)
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`
const timeout = Number(process.env.DOCS_SCREENSHOT_TIMEOUT || 120_000)
const screenshotNames = [
  'first-run.png',
  'playground-dock.png',
  'dock-compact.png',
  'dock-minimized.png',
  'dock-mobile.png',
  'site-manager.png',
  'new-playground.png',
  'app-manager.png',
  'boot-insights.png',
]

let server
let browser

function outputPath(name) {
  return path.join(outputDir, name)
}

async function waitForServer() {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (server?.exitCode != null) {
      throw new Error(`Playground dev server exited with code ${server.exitCode}`)
    }
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${baseUrl}`)
}

async function startServer() {
  if (externalBaseUrl) return
  await execFileAsync(process.execPath, ['scripts/generate-python-sources.mjs'], {
    cwd: rootDir,
  })
  server = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    { cwd: rootDir, stdio: 'inherit' },
  )
  await waitForServer()
}

async function settle(page) {
  await page.waitForTimeout(250)
}

async function waitForCatalogImages(dialog) {
  await dialog.locator('img').first().waitFor({ timeout: 15_000 })
  await dialog.locator('img').evaluateAll(async images => {
    await Promise.all(images.map(image => {
      if (image.complete && image.naturalWidth > 0) return Promise.resolve()
      return new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true })
        image.addEventListener('error', () => reject(
          new Error(`Failed to load app icon: ${image.src}`),
        ), { once: true })
      })
    }))
  })
  const unloaded = await dialog.locator('img').evaluateAll(images => images
    .filter(image => !image.complete || image.naturalWidth === 0)
    .map(image => image.src))
  if (unloaded.length) throw new Error(`App icons did not load: ${unloaded.join(', ')}`)
}

async function capture() {
  await fs.mkdir(outputDir, { recursive: true })
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  const introAction = page.getByRole('button', { name: 'I understand' })
  await introAction.waitFor({ timeout })
  await page.screenshot({ path: outputPath('first-run.png'), scale: 'css' })
  await introAction.click()
  await settle(page)

  const dock = () => page
    .locator('button[aria-label="Reload frame"]')
    .locator('xpath=../..')

  await dock().screenshot({ path: outputPath('playground-dock.png') })
  await page.getByTitle('Toggle actions').click()
  await settle(page)
  await dock().screenshot({ path: outputPath('dock-compact.png') })

  await page.getByTitle('Minimize Dock').click()
  await settle(page)
  await page.getByTitle('Expand Playground Dock').screenshot({
    path: outputPath('dock-minimized.png'),
  })
  await page.getByTitle('Expand Playground Dock').click()
  await page.getByTitle('Toggle actions').click()

  await page.setViewportSize({ width: 390, height: 844 })
  await settle(page)
  await dock().screenshot({ path: outputPath('dock-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await settle(page)

  await page.getByRole('button', { name: 'Manage playgrounds' }).click()
  await page.getByRole('button', {
    name: 'Actions for My Playground',
    exact: true,
  }).click()
  await settle(page)
  await page.screenshot({ path: outputPath('site-manager.png'), scale: 'css' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New Playground' }).click()
  await settle(page)
  await page.screenshot({ path: outputPath('new-playground.png'), scale: 'css' })
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Manage apps' }).click()
  await waitForCatalogImages(page.getByRole('dialog'))
  await page.screenshot({ path: outputPath('app-manager.png'), scale: 'css' })
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Playground info' }).click()
  await page.getByRole('tab', { name: 'Insights' }).click()
  await settle(page)
  await page.screenshot({ path: outputPath('boot-insights.png'), scale: 'css' })

  if (pageErrors.length) {
    throw new Error(`Browser errors while capturing screenshots:\n${pageErrors.join('\n')}`)
  }
  for (const name of screenshotNames) {
    const stats = await fs.stat(outputPath(name))
    if (stats.size === 0) throw new Error(`Empty screenshot: ${name}`)
  }
  console.log(`Captured ${screenshotNames.length} screenshots in ${outputDir}`)
}

async function cleanup() {
  await browser?.close()
  if (server && server.exitCode == null) {
    server.kill('SIGTERM')
    await Promise.race([
      new Promise(resolve => server.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 2_000)),
    ])
  }
}

try {
  await startServer()
  await capture()
} finally {
  await cleanup()
}
