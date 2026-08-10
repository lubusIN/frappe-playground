const { test, expect } = require('@playwright/test')
const {
  dismissIntroDialogIfShown,
  getFrappeFrame,
  waitForPlaygroundBoot,
} = require('./helpers/frappeFlow')

test('installs, restores, and uninstalls a catalog app from the app manager', async ({ page }) => {
  page.on('console', message => console.log(`[BROWSER]: ${message.text()}`))
  await waitForPlaygroundBoot(page)

  await page.getByRole('button', { name: 'Manage apps' }).click()
  await expect(page.getByRole('dialog')).toContainText('Frappe Wiki')
  await expect(page.getByRole('dialog')).toContainText('Available')
  const shellReloaded = page.waitForEvent('load', { timeout: 300000 })
  await page.getByTestId('install-app-wiki').click()
  await expect(page.getByText('Installing the app and updating its DocTypes.')).toBeVisible()

  // Successful installation persists the scoped database and reloads the shell
  // so Frappe starts with the new hooks and app list.
  await shellReloaded
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 })
  await expect(page.locator('#frappe-desk')).toBeVisible({ timeout: 120000 })
  await getFrappeFrame(page)
  await dismissIntroDialogIfShown(page)

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
  await expect(page.getByRole('dialog')).toContainText('Available')
  await expect(page.getByTestId('install-app-wiki')).toBeVisible()
})
