import {
  ProtocolMessageType,
  RuntimeStage,
  createClaimClientsMessage,
  createClearOtherInstancesMessage,
  createInitChannelMessage,
  isProtocolMessage,
} from '../../../protocol/src/messages.js'
import { getOrCreateInstanceSession } from './session.js'

export const PlaygroundEventType = Object.freeze({
  PROGRESS: 'progress',
  READY: 'ready',
  ERROR: 'error',
})

export class PlaygroundController {
  constructor(options = {}) {
    this.options = {
      serviceWorkerUrl: '/sw.js',
      serverWorkerUrl: '/worker.js',
      recoveryChannelName: 'sw-recovery',
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
      this.handleControllerChange = () => {
        if (isInitialLoad) {
          isInitialLoad = false
        } else if (!this.disposed && !this.reloadingForServiceWorkerUpdate) {
          this.reloadingForServiceWorkerUpdate = true
          console.log('[Playground] Service Worker updated! Auto-reloading to apply changes...')
          this.environment.location.reload()
        }
      }
      serviceWorker.addEventListener('controllerchange', this.handleControllerChange)

      const registration = await serviceWorker.register(this.options.serviceWorkerUrl, {
        type: 'module',
      })
      this.registration = registration
      await this.checkForServiceWorkerUpdate()

      if (!serviceWorker.controller) {
        const controllerReady = new Promise(resolve => {
          serviceWorker.addEventListener('controllerchange', resolve, { once: true })
        })
        registration.active?.postMessage(createClaimClientsMessage())
        this.progress(RuntimeStage.SERVICE_WORKER, 'active', 'Connecting service worker...')
        await controllerReady
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
    const query = new URLSearchParams({ scope: id, fresh: String(freshSession) })
    this.worker = new this.environment.WorkerClass(
      `${this.options.serverWorkerUrl}?${query}`,
      { type: 'module' },
    )

    this.worker.onmessage = event => {
      if (isProtocolMessage(event.data, ProtocolMessageType.RUNTIME_LOG)) {
        const { stage, status, message } = event.data.payload
        this.progress(stage, status, message)
        return
      }

      if (isProtocolMessage(event.data, ProtocolMessageType.RUNTIME_READY)) {
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
      if (this.session.freshSession) {
        serviceWorker.postMessage(createClearOtherInstancesMessage(this.session.id))
      }
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
