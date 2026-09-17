const { test, expect } = require('@playwright/test')
const { waitForPlaygroundBoot, getFrappeFrame } = require('./helpers/frappeFlow')

test('base Frappe loads compiled catalogs on demand and translates after language changes', async ({ page }) => {
  await waitForPlaygroundBoot(page)
  const cachedLanguages = () => page.evaluate(async () => {
    const urls = []
    for (const name of await caches.keys()) {
      if (!name.startsWith('frappe-assets-')) continue
      for (const request of await (await caches.open(name)).keys()) {
        const match = /\/assets\/locale\/([^/]+)\/LC_MESSAGES\/frappe\.mo/.exec(request.url)
        if (match) urls.push(match[1])
      }
    }
    return [...new Set(urls)].sort()
  })
  expect(await cachedLanguages()).toEqual([])
  const frame = await getFrappeFrame(page)
  for (const [language, password] of [['de', 'Passwort'], ['fr', 'Mot de Passe'], ['de', 'Passwort'], ['pt-BR', 'Senha']]) {
    await frame.goto(`/login?_lang=${language}`)
    await expect(frame.locator('label[for="login_password"]')).toHaveText(password)
  }
  expect(await cachedLanguages()).toEqual(['de', 'fr', 'pt', 'pt_BR'])
  await page.reload()
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120000 })
  const restored = await getFrappeFrame(page)
  await restored.goto('/login?_lang=fr')
  await expect(restored.locator('label[for="login_password"]')).toHaveText('Mot de Passe')
  expect(await cachedLanguages()).toEqual(['de', 'fr', 'pt', 'pt_BR'])
})

test('base Frappe uses the saved user language after a reload', async ({ page }) => {
  const { bootLoginAndReachDesk } = require('./helpers/frappeFlow')
  await bootLoginAndReachDesk(page)
  const frame = await getFrappeFrame(page)
  await frame.evaluate(async () => {
    await frappe.call('frappe.client.set_value', {
      doctype: 'User', name: 'Administrator', fieldname: 'language', value: 'fr',
    })
  })
  await page.reload()
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120000 })
  const restored = await getFrappeFrame(page)
  await expect.poll(() => restored.evaluate(() => window.frappe?.boot?.lang)).toBe('fr')
  expect(await restored.evaluate(() => __('Save'))).toBe('Enregistrer')
})
