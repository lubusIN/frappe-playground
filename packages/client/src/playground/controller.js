import {
  ProtocolMessageType,
  RuntimeStage,
  createInitChannelMessage,
  isProtocolMessage,
} from '../../../protocol/src/messages.js'
import { getOrCreateInstanceSession } from './session.js'
import { runtimeEntryUrl } from './runtime-version.js'

export const PlaygroundEventType = Object.freeze({
  PROGRESS: 'progress',
  READY: 'ready',
  ERROR: 'error',
})

export class PlaygroundController {
  constructor(options = {}) {
    this.options = {
      serviceWorkerUrl: runtimeEntryUrl('/sw.js'),
      serverWorkerUrl: runtimeEntryUrl('/worker.js'),
      recoveryChannelName: 'sw-recovery',
      serviceWorkerUpgradeTimeoutMs: 30000,
      readyDelayMs: 2000,
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
    }
    this.listeners = new Map()
    this.session = null
    this.worker = null
    this.recoveryChannel = null
    this.readyTimer = 0
    this.runtimeReady = false
    this.started = false
    this.disposed = false
    this.handleControllerChange = null
    this.handleVisibilityChange = null
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
      this.session = getOrCreateInstanceSession({
        storage: this.options.storage,
        cryptoApi: this.options.cryptoApi,
        now: this.options.now,
        random: this.options.random,
      })

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

      const registration = await serviceWorker.register(this.options.serviceWorkerUrl, {
        type: 'module',
        updateViaCache: 'none',
      })
      this.registration = registration
      await this.checkForServiceWorkerUpdate()

      if (!serviceWorker.controller || !this.isExpectedServiceWorker(serviceWorker.controller)) {
        const controllerReady = this.waitForExpectedServiceWorker(serviceWorker)
        this.progress(RuntimeStage.SERVICE_WORKER, 'active', 'Updating service worker...')
        const upgraded = await controllerReady
        if (upgraded === false) {
          throw new Error('The service worker update did not activate. Reload the page to retry.')
        }
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
        if (this.runtimeReady) return
        this.runtimeReady = true
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
      }
    }

    this.worker.onerror = error => {
      this.emitError(new Error(error.message || 'Frappe runtime failed to start.'))
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
    if (serviceWorker.controller) {
      sendInit(serviceWorker.controller)
    } else {
      serviceWorker.ready.then(registration => sendInit(registration.active))
    }
  }

  setupRecovery() {
    this.recoveryChannel = new this.environment.BroadcastChannelClass(
      this.options.recoveryChannelName,
    )
    this.recoveryChannel.onmessage = event => {
      if (isProtocolMessage(event.data, ProtocolMessageType.RECOVERY_REQUEST)) {
        console.log('[Playground] Service Worker requested channel recovery.')
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

  isExpectedServiceWorker(worker) {
    if (!worker?.scriptURL) return true
    const baseUrl = this.environment.location?.href || 'http://localhost/'
    return worker.scriptURL === new URL(this.options.serviceWorkerUrl, baseUrl).href
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

  dispose() {
    this.disposed = true
    this.started = false
    this.environment.clearTimeoutFn(this.readyTimer)
    this.runtimeReady = false
    this.worker?.terminate()
    this.worker = null
    this.registration = null
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
