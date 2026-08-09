const { test, expect } = require('@playwright/test')
const { waitForPlaygroundBoot, getFrappeFrame } = require('./helpers/frappeFlow')

test('creates and boots an independent playground instance', async ({ page }) => {
  page.on('console', message => console.log(`[BROWSER]: ${message.text()}`))
  page.on('pageerror', error => console.log(`[BROWSER ERROR]: ${error.message}`))
  const { instanceId: firstInstanceId } = await waitForPlaygroundBoot(page)

  await page.getByRole('button', { name: 'Manage playgrounds' }).click()
  await page.getByRole('button', { name: 'New playground' }).click()
  await page.getByRole('textbox', { name: 'Playground name' }).fill('Second Site', { timeout: 30000 })
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 })
  await getFrappeFrame(page)

  const state = await page.evaluate(() => ({
    activeId: localStorage.getItem('frappe_playground_instance_id'),
    instances: JSON.parse(localStorage.getItem('frappe_playground_instances') || '[]'),
  }))

  expect(state.activeId).not.toBe(firstInstanceId)
  expect(state.instances).toHaveLength(2)
  expect(state.instances.find(instance => instance.id === state.activeId).name).toBe('Second Site')
  expect(state.instances.map(instance => instance.id)).toContain(firstInstanceId)
  await expect(page.getByText('Second Site', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Manage playgrounds' }).click()
  await page.getByRole('button', { name: 'Actions for Second Site' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByRole('textbox', { name: 'Playground name' }).fill('Renamed Site')
  await page.getByRole('button', { name: 'Rename', exact: true }).click()

  await expect(page.getByText('Renamed Site', { exact: true }).first()).toBeVisible()
  const renamed = await page.evaluate(() => (
    JSON.parse(localStorage.getItem('frappe_playground_instances') || '[]')
      .find(instance => instance.id === localStorage.getItem('frappe_playground_instance_id'))
  ))
  expect(renamed.name).toBe('Renamed Site')
})
