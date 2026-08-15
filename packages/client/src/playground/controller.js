import {
  ProtocolMessageType,
  RuntimeStage,
  createAppInstallMessage,
  createAppUninstallMessage,
  createInitChannelMessage,
  isProtocolMessage,
} from '../../../protocol/src/messages.js'
import { validateAppId } from '../../../protocol/src/app-catalog.js'
import { getOrCreateInstanceSession, selectInstanceSession } from './session.js'
import { runtimeEntryUrl } from './runtime-version.js'

export const PlaygroundEventType = Object.freeze({
  PROGRESS: 'progress',
  READY: 'ready',
  ERROR: 'error',
  WAKING_UP: 'waking_up',
  WOKE_UP: 'woke_up',
})

export class PlaygroundController {
  constructor(options = {}) {
    const appOperationTimeoutMs = options.appOperationTimeoutMs
      ?? options.appInstallTimeoutMs
      ?? 600000
    this.options = {
      serviceWorkerUrl: runtimeEntryUrl('/sw.js'),
      serverWorkerUrl: runtimeEntryUrl('/worker.js'),
      recoveryChannelName: 'sw-recovery',
      serviceWorkerRegistrationTimeoutMs: 15000,
      serviceWorkerUpgradeTimeoutMs: 30000,
      readyDelayMs: 2000,
      appOperationTimeoutMs,
      ...options,
    }
    this.environment = {
      navigator: options.navigator || globalThis.navigator,
      document: options.document || globalThis.document,
      location: options.location || globalThis.location,
      WorkerClass: options.WorkerClass || globalThis.Worker,
      MessageChannelClass: options.MessageChannelClass || globalThis.MessageChannel,
      BroadcastChannelClass: options.BroadcastChannelClass || globalThis.BroadcastChannel,
      setTimeoutFn: options.setTimeoutFn || ((...args) => globalThis.setTimeout(...args)),
      clearTimeoutFn: options.clearTimeoutFn || (timer => globalThis.clearTimeout(timer)),
      registrationSetTimeoutFn: options.registrationSetTimeoutFn
        || ((...args) => globalThis.setTimeout(...args)),
      registrationClearTimeoutFn: options.registrationClearTimeoutFn
        || (timer => globalThis.clearTimeout(timer)),
    }
    this.listeners = new Map()
    this.session = null
    this.worker = null
    this.recoveryChannel = null
    this.readyTimer = 0
    this.runtimeReady = false
    this.installedApps = []
    this.started = false
    this.disposed = false
    this.handleControllerChange = null
    this.handleVisibilityChange = null
    this.pendingAppOperations = new Map()
  }

  on(type, listener) {
    const listeners = this.listeners.get(type) || new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
    return () => listeners.delete(listener)
  }

  emit(type, detail) {
    for (const listener of this.listeners.get(type) || []) listener(detail)
  }

  progress(stage, status, message) {
    this.emit(PlaygroundEventType.PROGRESS, { stage, status, message })
  }

  async start() {
    if (this.started) return this.session
    this.started = true
    this.disposed = false
    this.reloadingForServiceWorkerUpdate = false

    try {
      const serviceWorker = this.environment.navigator?.serviceWorker
      if (!serviceWorker) throw new Error('Service workers are unavailable in this browser.')

      this.progress(RuntimeStage.SERVICE_WORKER, 'active', 'Starting service worker...')
      const sessionOptions = {
        storage: this.options.storage,
        cryptoApi: this.options.cryptoApi,
        now: this.options.now,
        random: this.options.random,
      }
      this.session = this.options.session || (this.options.instanceId
        ? selectInstanceSession(this.options.instanceId, sessionOptions)
        : getOrCreateInstanceSession(sessionOptions))
      if (!this.session) {
        throw new Error(`Playground instance not found: ${this.options.instanceId}`)
      }

      let isInitialLoad = !serviceWorker.controller
      let isUpgradingLegacyWorker = !isInitialLoad
        && !this.isExpectedServiceWorker(serviceWorker.controller)
      this.handleControllerChange = () => {
        if (isInitialLoad || isUpgradingLegacyWorker) {
          isInitialLoad = false
          isUpgradingLegacyWorker = false
        } else if (!this.disposed && !this.reloadingForServiceWorkerUpdate) {
          this.reloadingForServiceWorkerUpdate = true
          console.log('[Playground] Service Worker updated! Auto-reloading to apply changes...')
          this.environment.location.reload()
        }
      }
      serviceWorker.addEventListener('controllerchange', this.handleControllerChange)

      const registration = await this.withRegistrationTimeout(
        serviceWorker.register(this.options.serviceWorkerUrl, {
          type: 'module',
          updateViaCache: 'none',
        }),
      )
      this.registration = registration
      this.serviceWorkerTarget = this.expectedServiceWorker(serviceWorker, registration)

      if (!this.serviceWorkerTarget) {
        const controllerReady = this.waitForExpectedServiceWorker(serviceWorker)
        this.progress(RuntimeStage.SERVICE_WORKER, 'active', 'Updating service worker...')
        const upgraded = await controllerReady
        if (upgraded === false) {
          throw new Error('The service worker update did not activate. Reload the page to retry.')
        }
        this.serviceWorkerTarget = serviceWorker.controller
      }

      this.progress(RuntimeStage.SERVICE_WORKER, 'done', 'Service worker connected.')
      this.createWorker()
      this.setupChannel()
      this.setupRecovery()
      return this.session
    } catch (error) {
      this.started = false
      this.emitError(error)
      throw error
    }
  }

  createWorker() {
    const { id, freshSession } = this.session
    this.runtimeReady = false
    const query = new URLSearchParams({ scope: id, fresh: String(freshSession) })
    const separator = this.options.serverWorkerUrl.includes('?') ? '&' : '?'
    this.worker = new this.environment.WorkerClass(
      `${this.options.serverWorkerUrl}${separator}${query}`,
      { type: 'module' },
    )

    this.worker.onmessage = event => {
      if (isProtocolMessage(event.data, ProtocolMessageType.RUNTIME_LOG)) {
        const { stage, status, message } = event.data.payload
        this.progress(stage, status, message)
        return
      }

      if (isProtocolMessage(event.data, ProtocolMessageType.RUNTIME_READY)) {
        if (this.runtimeReady) {
          this.emit(PlaygroundEventType.WOKE_UP)
          return
        }
        this.runtimeReady = true
        this.installedApps = Array.isArray(event.data.payload?.installedApps)
          ? [...event.data.payload.installedApps]
          : []
        this.progress(RuntimeStage.FRAPPE, 'done', 'Frappe booted successfully!')
        this.readyTimer = this.environment.setTimeoutFn(() => {
          if (!this.disposed) {
            this.emit(PlaygroundEventType.READY, { instanceId: this.session.id })
          }
        }, this.options.readyDelayMs)
        return
      }

      if (isProtocolMessage(event.data, ProtocolMessageType.RUNTIME_ERROR)) {
        this.emitError(new Error(event.data.payload.message))
        return
      }

      if (isProtocolMessage(event.data, ProtocolMessageType.APP_INSTALL_RESULT)) {
        const pending = this.pendingAppOperations.get(event.data.payload.requestId)
        if (!pending) return
        this.environment.clearTimeoutFn(pending.timeout)
        this.pendingAppOperations.delete(event.data.payload.requestId)
        if (event.data.payload.installed) {
          if (!this.installedApps.includes(event.data.payload.appId)) {
            this.installedApps.push(event.data.payload.appId)
          }
          pending.resolve(event.data.payload)
        }
        else pending.reject(new Error(event.data.payload.error || 'App installation failed.'))
        return
      }

      if (isProtocolMessage(event.data, ProtocolMessageType.APP_UNINSTALL_RESULT)) {
        const pending = this.pendingAppOperations.get(event.data.payload.requestId)
        if (!pending) return
        this.environment.clearTimeoutFn(pending.timeout)
        this.pendingAppOperations.delete(event.data.payload.requestId)
        if (event.data.payload.uninstalled) {
          this.installedApps = this.installedApps.filter(appId => appId !== event.data.payload.appId)
          pending.resolve(event.data.payload)
        } else {
          pending.reject(new Error(event.data.payload.error || 'App uninstall failed.'))
        }
      }
    }

    this.worker.onerror = error => {
      let msg = error.message || 'Frappe runtime failed to start.'
      if (msg.includes("Unexpected token '{'") || msg.includes('SyntaxError') || msg.includes('import declarations')) {
        msg = 'Your browser is too old to run the Frappe Playground. Please update your device or switch to a modern browser.'
      }
      this.emitError(new Error(msg))
    }
  }

  setupChannel() {
    if (this.disposed || !this.worker) return

    const sendInit = serviceWorker => {
      if (!serviceWorker || this.disposed) return
      const channel = new this.environment.MessageChannelClass()
      serviceWorker.postMessage(createInitChannelMessage(this.session.id), [channel.port1])
      this.worker.postMessage(
        createInitChannelMessage(this.session.id, {
          freshSession: this.session.freshSession,
        }),
        [channel.port2],
      )
    }

    const serviceWorker = this.environment.navigator.serviceWorker
    const target = this.expectedServiceWorker(serviceWorker, this.registration)
      || this.serviceWorkerTarget
    if (target) {
      this.serviceWorkerTarget = target
      sendInit(target)
    } else {
      serviceWorker.ready.then(registration => {
        this.serviceWorkerTarget = registration.active
        sendInit(registration.active)
      })
    }
  }

  setupRecovery() {
    this.recoveryChannel = new this.environment.BroadcastChannelClass(
      this.options.recoveryChannelName,
    )
    this.recoveryChannel.onmessage = event => {
      if (isProtocolMessage(event.data, ProtocolMessageType.RECOVERY_REQUEST)) {
        console.log('[Playground] Service Worker requested channel recovery.')
        this.emit(PlaygroundEventType.WAKING_UP)
        this.setupChannel()
      }
    }

    this.handleVisibilityChange = () => {
      if (this.environment.document.visibilityState === 'visible') {
        this.checkForServiceWorkerUpdate()
        this.setupChannel()
      }
    }
    this.environment.document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  async checkForServiceWorkerUpdate() {
    try {
      await this.registration?.update?.()
    } catch (error) {
      // A transient update failure must not prevent the active worker from booting.
      console.warn('[Playground] Service Worker update check failed.', error)
    }
  }

  withRegistrationTimeout(registrationPromise) {
    return new Promise((resolve, reject) => {
      const timeout = this.environment.registrationSetTimeoutFn(() => {
        reject(new Error('Service worker registration timed out.'))
      }, this.options.serviceWorkerRegistrationTimeoutMs)

      Promise.resolve(registrationPromise).then(
        registration => {
          this.environment.registrationClearTimeoutFn(timeout)
          resolve(registration)
        },
        error => {
          this.environment.registrationClearTimeoutFn(timeout)
          reject(error)
        },
      )
    })
  }

  isExpectedServiceWorker(worker) {
    if (!worker) return false
    if (!worker.scriptURL) return true
    const baseUrl = this.environment.location?.href || 'http://localhost/'
    return worker.scriptURL === new URL(this.options.serviceWorkerUrl, baseUrl).href
  }

  expectedServiceWorker(serviceWorker, registration) {
    if (this.isExpectedServiceWorker(serviceWorker?.controller)) {
      return serviceWorker.controller
    }
    if (this.isExpectedServiceWorker(registration?.active)) {
      return registration.active
    }
    return null
  }

  waitForExpectedServiceWorker(serviceWorker) {
    return new Promise(resolve => {
      let timeout
      const finish = result => {
        serviceWorker.removeEventListener('controllerchange', handleControllerChange)
        this.environment.clearTimeoutFn(timeout)
        resolve(result)
      }
      const handleControllerChange = () => {
        if (this.isExpectedServiceWorker(serviceWorker.controller)) finish(true)
      }

      serviceWorker.addEventListener('controllerchange', handleControllerChange)
      timeout = this.environment.setTimeoutFn(
        () => finish(false),
        this.options.serviceWorkerUpgradeTimeoutMs,
      )
    })
  }

  emitError(error) {
    this.emit(PlaygroundEventType.ERROR, {
      error,
      message: error.message || 'Frappe runtime failed to start.',
    })
  }

  installApp(appId) {
    validateAppId(appId)
    return this.requestAppOperation(appId, createAppInstallMessage, 'installing')
  }

  uninstallApp(appId) {
    validateAppId(appId)
    if (!this.installedApps.includes(appId)) {
      return Promise.reject(new Error(`${appId} is not installed in this playground.`))
    }
    return this.requestAppOperation(appId, createAppUninstallMessage, 'uninstalling')
  }

  requestAppOperation(appId, createMessage, action) {
    if (!this.runtimeReady || !this.worker) {
      return Promise.reject(new Error(`The playground must finish booting before ${action} apps.`))
    }

    const requestId = this.options.cryptoApi?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(16).slice(2)}`
    return new Promise((resolve, reject) => {
      const timeout = this.environment.setTimeoutFn(() => {
        this.pendingAppOperations.delete(requestId)
        reject(new Error(`Timed out while ${action} ${appId}.`))
      }, this.options.appOperationTimeoutMs)
      this.pendingAppOperations.set(requestId, { resolve, reject, timeout })
      this.worker.postMessage(createMessage(requestId, appId))
    })
  }

  listInstalledApps() {
    return [...this.installedApps]
  }

  dispose() {
    this.disposed = true
    this.started = false
    this.environment.clearTimeoutFn(this.readyTimer)
    this.runtimeReady = false
    this.installedApps = []
    for (const pending of this.pendingAppOperations.values()) {
      this.environment.clearTimeoutFn(pending.timeout)
      pending.reject(new Error('Playground stopped before the app operation completed.'))
    }
    this.pendingAppOperations.clear()
    this.worker?.terminate()
    this.worker = null
    this.registration = null
    this.serviceWorkerTarget = null
    this.recoveryChannel?.close()
    this.recoveryChannel = null

    const serviceWorker = this.environment.navigator?.serviceWorker
    if (this.handleControllerChange) {
      serviceWorker?.removeEventListener('controllerchange', this.handleControllerChange)
    }
    if (this.handleVisibilityChange) {
      this.environment.document?.removeEventListener(
        'visibilitychange',
        this.handleVisibilityChange,
      )
    }
    this.listeners.clear()
  }
}

export function createPlayground(options) {
  return new PlaygroundController(options)
}
