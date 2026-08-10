const { test, expect } = require('@playwright/test')
const {
  bootLoginAndReachDesk,
  dismissIntroDialogIfShown,
  getFrappeFrame,
} = require('./helpers/frappeFlow')

test('installs, restores, and uninstalls a catalog app from the app manager', async ({ page }) => {
  const consoleMessages = []
  page.on('console', message => {
    consoleMessages.push(message.text())
    console.log(`[BROWSER]: ${message.text()}`)
  })
  await bootLoginAndReachDesk(page)

  await page.getByRole('button', { name: 'Manage apps' }).click()
  await expect(page.getByRole('dialog')).toContainText('Frappe Wiki')
  await expect(page.getByTestId('install-app-wiki')).toBeVisible()
  const shellReloaded = page.waitForEvent('load', { timeout: 300000 })
  await page.getByTestId('install-app-wiki').click()
  await expect(page.getByText('Installing the app and updating its DocTypes.')).toBeVisible()

  // Successful installation persists the scoped database and reloads the shell
  // so Frappe starts with the new hooks and app list.
  await shellReloaded
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 })
  await expect(page.locator('#frappe-desk')).toBeVisible({ timeout: 120000 })
  const restoredFrame = await getFrappeFrame(page)
  await dismissIntroDialogIfShown(page)
  expect(consoleMessages.some(message => message.includes('Error creating icons'))).toBe(false)

  const wikiTabPromise = page.waitForEvent('popup', { timeout: 120000 })
  const standaloneRequests = []
  page.context().on('request', request => standaloneRequests.push(request.url()))
  await restoredFrame.evaluate(() => window.open('/wiki', '_blank'))
  const wikiTab = await wikiTabPromise
  await wikiTab.waitForURL(url => url.pathname === '/wiki/spaces', { timeout: 120000 })
  await wikiTab.waitForTimeout(10000)
  expect(new URL(wikiTab.url()).pathname).toBe('/wiki/spaces')
  expect(standaloneRequests.some(url => new URL(url).pathname.endsWith('/login'))).toBe(false)
  expect(standaloneRequests.some(url => new URL(url).port === '9000')).toBe(false)
  const socketRequests = standaloneRequests.filter(
    url => new URL(url).pathname.includes('/socket.io/'),
  )
  expect(socketRequests.length).toBeGreaterThan(0)
  expect(socketRequests.length).toBeLessThanOrEqual(5)
  await expect.poll(async () => wikiTab.url(), { timeout: 30000 }).not.toContain('site1')
  await wikiTab.close()

  await page.getByRole('button', { name: 'Manage apps' }).click()
  await expect(page.getByRole('dialog')).toContainText('Frappe Wiki')
  await expect(page.getByRole('dialog')).toContainText('Installed')
  await expect(page.getByTestId('install-app-wiki')).toHaveCount(0)

  await page.getByTestId('uninstall-app-wiki').click()
  await expect(page.getByRole('dialog')).toContainText('Uninstall app?')
  await expect(page.getByRole('dialog')).toContainText('permanently removed')
  const shellReloadedAfterUninstall = page.waitForEvent('load', { timeout: 300000 })
  await page.getByRole('button', { name: 'Uninstall', exact: true }).click()
  await expect(page.getByText('Removing the app and its data.')).toBeVisible()

  await shellReloadedAfterUninstall
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 })
  await expect(page.locator('#frappe-desk')).toBeVisible({ timeout: 120000 })
  await getFrappeFrame(page)
  await dismissIntroDialogIfShown(page)

  await page.getByRole('button', { name: 'Manage apps' }).click()
  await expect(page.getByRole('dialog')).toContainText('Frappe Wiki')
  await expect(page.getByTestId('install-app-wiki')).toBeVisible()
})
