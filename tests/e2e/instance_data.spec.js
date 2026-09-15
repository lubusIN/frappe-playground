const { test, expect } = require('@playwright/test')
const { waitForPlaygroundBoot, getFrappeFrame, dismissIntroDialogIfShown } = require('./helpers/frappeFlow')

test('active reset reboots and blocked deletion waits before creating a replacement', async ({ page }) => {
  const { instanceId } = await waitForPlaygroundBoot(page)
  const name = await page.evaluate(() => JSON.parse(localStorage.getItem('frappe_playground_instances'))[0].name)
  const choose = async action => {
    await page.getByRole('button', { name: 'Manage playgrounds' }).click()
    await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click()
    await page.getByRole('menuitem', { name: action, exact: true }).click()
    await page.getByRole('button', { name: action, exact: true }).click()
  }
  await choose('Reset')
  await expect(page.locator('#frappe-desk')).toBeVisible({ timeout: 600000 })
  await getFrappeFrame(page)
  await dismissIntroDialogIfShown(page)
  expect(await page.evaluate(() => localStorage.getItem('frappe_playground_instance_id'))).toBe(instanceId)

  await page.evaluate(id => new Promise((resolve, reject) => {
    const request = indexedDB.open(`frappe_playground_db_${id}`, 1)
    request.onsuccess = () => { window.blockingDatabase = request.result; resolve() }
    request.onerror = () => reject(request.error)
  }), instanceId)
  await choose('Delete')
  await expect(page.getByRole('status')).toContainText('Close other tabs', { timeout: 30000 })
  await expect(page.locator('#frappe-desk')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('frappe_playground_instances')).length)).toBe(1)

  await page.evaluate(() => window.blockingDatabase.close())
  await expect(page.locator('#frappe-desk')).toBeVisible({ timeout: 600000 })
  await getFrappeFrame(page)
  const replacement = await page.evaluate(() => JSON.parse(localStorage.getItem('frappe_playground_instances')))
  expect(replacement).toHaveLength(1)
  expect(replacement[0].id).not.toBe(instanceId)
})
