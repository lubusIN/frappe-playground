const { test, expect } = require('@playwright/test')
const {
  bootLoginAndReachDesk,
  dismissIntroDialogIfShown,
  getFrappeFrame,
} = require('./helpers/frappeFlow')

const APPS_TO_TEST = [
  {
    id: 'wiki',
    name: 'Frappe Wiki',
    heavy: true,
    async customAssertions(page, restoredFrame) {
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
    }
  },
  {
    id: 'frappe_vault',
    name: 'Frappe Vault',
    heavy: false,
    async customAssertions(page, restoredFrame) {
      const vaultTabPromise = page.waitForEvent('popup', { timeout: 120000 })
      await restoredFrame.evaluate(() => window.open('/vault', '_blank'))
      const vaultTab = await vaultTabPromise
      await vaultTab.waitForURL(url => url.pathname === '/vault' || url.pathname === '/vault/', {
        timeout: 120000,
      })
      await expect(vaultTab.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
        timeout: 120000,
      })
      expect(new URL(vaultTab.url()).hostname).toMatch(/localhost|127\.0\.0\.1/)
      expect(vaultTab.url()).not.toContain('site1')
      await vaultTab.close()
    }
  },
  {
    id: 'crm',
    name: 'Frappe CRM',
    heavy: true,
    async customAssertions(page, restoredFrame) {
      const crmTabPromise = page.waitForEvent('popup', { timeout: 120000 })
      await restoredFrame.evaluate(() => window.open('/crm', '_blank'))
      const crmTab = await crmTabPromise
      await crmTab.waitForURL(url => url.pathname.startsWith('/crm/'), { timeout: 120000 })
      await expect(crmTab.getByText('Leads', { exact: true }).first()).toBeVisible({
        timeout: 120000,
      })
      expect(new URL(crmTab.url()).hostname).toMatch(/localhost|127\.0\.0\.1/)
      expect(crmTab.url()).not.toContain('site1')
      expect(new URL(crmTab.url()).pathname).not.toContain('/login')
      await crmTab.close()
    }
  }
]

for (const app of APPS_TO_TEST) {
  test(`installs, opens, and uninstalls ${app.name}`, async ({ page, browserName }) => {
    if (app.heavy) {
      test.skip(process.env.CI && process.env.GITHUB_EVENT_NAME !== 'schedule', `Skipping heavy ${app.name} test on PRs`);
    }

    const consoleMessages = []
    page.on('console', message => {
      consoleMessages.push(message.text())
      console.log(`[BROWSER]: ${message.text()}`)
    })
    await bootLoginAndReachDesk(page)

    // Install
    await page.getByRole('button', { name: 'Manage apps' }).click()
    await expect(page.getByRole('dialog')).toContainText(app.name)
    await expect(page.getByTestId(`install-app-${app.id}`)).toBeVisible()
    const shellReloaded = page.waitForEvent('load', { timeout: 300000 })
    await page.getByTestId(`install-app-${app.id}`).click()
    await expect(page.getByRole('dialog')).toContainText('Install app?')
    await page.getByRole('button', { name: 'Install', exact: true }).click()
    await expect(page.getByText('This can take several minutes; keep this tab open. The playground will reload automatically when finished.')).toBeVisible()

    // Shell reload & Verify
    await shellReloaded
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 })
    await expect(page.locator('#frappe-desk')).toBeVisible({ timeout: 120000 })
    const restoredFrame = await getFrappeFrame(page)
    await dismissIntroDialogIfShown(page)
    expect(consoleMessages.some(message => message.includes('Error creating icons'))).toBe(false)

    // Custom App Assertions
    if (app.customAssertions) {
      await app.customAssertions(page, restoredFrame)
    }

    // Uninstall
    await page.getByRole('button', { name: 'Manage apps' }).click()
    await expect(page.getByRole('dialog')).toContainText(app.name)
    await expect(page.getByTestId(`install-app-${app.id}`)).toHaveCount(0)
    await page.getByTestId(`uninstall-app-${app.id}`).click()
    await expect(page.getByRole('dialog')).toContainText('Uninstall app?')

    const shellReloadedAfterUninstall = page.waitForEvent('load', { timeout: 300000 })
    await page.getByRole('button', { name: 'Uninstall', exact: true }).click()
    await expect(page.getByText('This can take several minutes; keep this tab open. The playground will reload automatically when finished.')).toBeVisible()
    await shellReloadedAfterUninstall
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 })
    await expect(page.locator('#frappe-desk')).toBeVisible({ timeout: 120000 })
    await getFrappeFrame(page)
    await dismissIntroDialogIfShown(page)

    // Final verification
    await page.getByRole('button', { name: 'Manage apps' }).click()
    await expect(page.getByTestId(`install-app-${app.id}`)).toBeVisible()
  })
}
