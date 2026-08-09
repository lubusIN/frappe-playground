const { test, expect } = require('@playwright/test')

test('installs a catalog app into one persisted playground scope', async ({ page }) => {
  page.on('console', message => console.log(`[BROWSER]: ${message.text()}`))
  await page.goto('/apps/catalog.json')

  const result = await page.evaluate(async () => {
    const {
      ProtocolMessageType,
      createAppInstallMessage,
      createInitChannelMessage,
    } = await import('/protocol/messages.js')
    const scope = `app-install-${crypto.randomUUID()}`
    const worker = new Worker(`/worker.js?scope=${scope}&fresh=true`, { type: 'module' })
    const channel = new MessageChannel()

    const installed = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('App installation timed out.')), 300000)
      worker.onerror = event => reject(new Error(event.message || 'Runtime worker failed.'))
      worker.onmessage = event => {
        if (event.data?.type === ProtocolMessageType.RUNTIME_ERROR) {
          clearTimeout(timeout)
          reject(new Error(event.data.payload.message))
        }
        if (event.data?.type === ProtocolMessageType.RUNTIME_READY) {
          worker.postMessage(createAppInstallMessage('install-wiki', 'wiki'))
        }
        if (event.data?.type === ProtocolMessageType.APP_INSTALL_RESULT) {
          clearTimeout(timeout)
          if (event.data.payload.installed) resolve(event.data.payload)
          else reject(new Error(event.data.payload.error || 'App installation failed.'))
        }
      }
      worker.postMessage(
        createInitChannelMessage(scope, { freshSession: true }),
        [channel.port2],
      )
    })

    const installedApps = await new Promise((resolve, reject) => {
      const request = indexedDB.open(`frappe_playground_db_${scope}`, 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const read = database.transaction('files', 'readonly')
          .objectStore('files')
          .get('installed_apps')
        read.onerror = () => reject(read.error)
        read.onsuccess = () => {
          database.close()
          resolve(read.result)
        }
      }
    })
    worker.terminate()

    const restoredWorker = new Worker(`/worker.js?scope=${scope}&fresh=false`, { type: 'module' })
    const restoredChannel = new MessageChannel()
    const restoredApps = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('App restore timed out.')), 300000)
      restoredWorker.onerror = event => reject(new Error(event.message || 'Restored worker failed.'))
      restoredWorker.onmessage = event => {
        if (event.data?.type === ProtocolMessageType.RUNTIME_ERROR) {
          clearTimeout(timeout)
          reject(new Error(event.data.payload.message))
        }
        if (event.data?.type === ProtocolMessageType.RUNTIME_READY) {
          clearTimeout(timeout)
          resolve(event.data.payload?.installedApps || [])
        }
      }
      restoredWorker.postMessage(
        createInitChannelMessage(scope, { freshSession: false }),
        [restoredChannel.port2],
      )
    })
    restoredWorker.terminate()
    return { installed, installedApps, restoredApps }
  })

  expect(result.installed).toMatchObject({ appId: 'wiki', installed: true })
  expect(result.installedApps).toEqual(['wiki'])
  expect(result.restoredApps).toEqual(['wiki'])
})
