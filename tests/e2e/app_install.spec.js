const { test, expect } = require('@playwright/test')
const {
  bootLoginAndReachDesk,
  dismissIntroDialogIfShown,
  getFrappeFrame,
} = require('./helpers/frappeFlow')

const APPS_TO_TEST = [
  {
    id: 'erpnext',
    name: 'ERPNext',
    heavy: true,
    async customAssertions(_page, restoredFrame) {
      // Verify the automatic refresh itself instead of rescuing it with navigation.
      expect(new URL(restoredFrame.url()).pathname).toContain('/desk')
      await expect(restoredFrame.getByText('Accounting', { exact: true }).first()).toBeVisible({
        timeout: 120000,
      })
    }
  },
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
  test(`installs, opens, and uninstalls ${app.name}`, async ({ page }) => {
    if (app.heavy) {
      test.skip(process.env.CI && process.env.GITHUB_EVENT_NAME !== 'schedule', `Skipping heavy ${app.name} test on PRs`);
    }

    const consoleMessages = []
    page.on('console', message => {
      consoleMessages.push(message.text())
      console.log(`[BROWSER]: ${message.text()}`)
    })
    const { instanceId } = await bootLoginAndReachDesk(page)
    const isRuntimeWorker = worker => new URL(worker.url()).pathname.endsWith('/worker.js')
    const workers = page.workers().filter(isRuntimeWorker)
    expect(workers).toHaveLength(1)
    let newWorkers = 0
    page.on('worker', worker => { if (isRuntimeWorker(worker)) newWorkers++ })
    const shellMarker = await page.evaluate(() => {
      window.appOperationShellMarker = crypto.randomUUID()
      return window.appOperationShellMarker
    })
    const initialFrame = await getFrappeFrame(page)
    const savedNote = await initialFrame.evaluate(async () => {
      const response = await fetch('/api/resource/ToDo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Survives app changes' }),
      })
      const { data } = await response.json()
      return data.name
    })
    const assertSameShell = async () => {
      expect(newWorkers).toBe(0)
      expect(page.workers().filter(isRuntimeWorker)).toEqual(workers)
      await expect(page.locator('#loading-screen')).toBeHidden()
      expect(await page.evaluate(() => window.appOperationShellMarker)).toBe(shellMarker)
      expect(await page.evaluate(() => localStorage.getItem('frappe_playground_instance_id'))).toBe(instanceId)
      const frame = await getFrappeFrame(page)
      const user = await frame.evaluate(async () => {
        const response = await fetch('/api/method/frappe.auth.get_logged_user')
        return response.json()
      })
      expect(user.message).toBe('Administrator')
      const note = await frame.evaluate(async name => {
        const response = await fetch(`/api/resource/ToDo/${encodeURIComponent(name)}`)
        return response.json()
      }, savedNote)
      expect(note.data.description).toBe('Survives app changes')
    }

    // Install
    await page.getByRole('button', { name: 'Manage apps' }).click()
    await expect(page.getByRole('dialog')).toContainText(app.name)
    await expect(page.getByTestId(`install-app-${app.id}`)).toBeVisible()
    await page.getByTestId(`install-app-${app.id}`).click()
    await expect(page.getByRole('dialog')).toContainText('Install app?')
    const installedView = page.waitForEvent('framenavigated', {
      predicate: frame => frame.parentFrame() === page.mainFrame(), timeout: 300000,
    })
    await page.getByRole('button', { name: 'Install', exact: true }).click()
    await expect(page.getByText('This can take several minutes; keep this tab open. The Frappe view will refresh automatically when finished.')).toBeVisible()

    await expect(page.getByRole('dialog')).toContainText(`${app.name} installed successfully.`, { timeout: 300000 })

    // Only the Frappe document refreshes; Python stays running.
    await installedView
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.locator('#frappe-desk')).toBeVisible({ timeout: 120000 })
    await assertSameShell()
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

    const uninstalledView = page.waitForEvent('framenavigated', {
      predicate: frame => frame.parentFrame() === page.mainFrame(), timeout: 300000,
    })
    await page.getByRole('button', { name: 'Uninstall', exact: true }).click()
    await expect(page.getByText('This can take several minutes; keep this tab open. The Frappe view will refresh automatically when finished.')).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText(`${app.name} uninstalled successfully.`, { timeout: 300000 })
    await uninstalledView
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.locator('#frappe-desk')).toBeVisible({ timeout: 120000 })
    await getFrappeFrame(page)
    await dismissIntroDialogIfShown(page)

    // Final verification
    await assertSameShell()
    const frame = await getFrappeFrame(page)
    const removedApp = await frame.evaluate(async appId => {
      const response = await fetch(`/api/method/${appId}.__version__`)
      return response.json()
    }, app.id)
    expect(removedApp.exc_type).toBe('ValidationError')
    expect(removedApp.exception).toContain(`App ${app.id} is not installed`)
    await page.getByRole('button', { name: 'Manage apps' }).click()
    await expect(page.getByTestId(`install-app-${app.id}`)).toBeVisible()
  })
}
