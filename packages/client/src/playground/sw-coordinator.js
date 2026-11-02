/**
 * Service Worker Coordinator for Frappe Playground.
 * Encapsulates Service Worker registration, version checking, update checking,
 * and controller change lifecycle management.
 */

export class ServiceWorkerCoordinator {
  constructor(options = {}) {
    this.options = {
      serviceWorkerUrl: options.serviceWorkerUrl,
      registrationTimeoutMs: options.serviceWorkerRegistrationTimeoutMs ?? 15000,
      upgradeTimeoutMs: options.serviceWorkerUpgradeTimeoutMs ?? 30000,
    }
    this.environment = {
      location: options.location || globalThis.location,
      setTimeoutFn: options.setTimeoutFn || ((...args) => globalThis.setTimeout(...args)),
      clearTimeoutFn: options.clearTimeoutFn || (timer => globalThis.clearTimeout(timer)),
      registrationSetTimeoutFn: options.registrationSetTimeoutFn
        || options.setTimeoutFn
        || ((...args) => globalThis.setTimeout(...args)),
      registrationClearTimeoutFn: options.registrationClearTimeoutFn
        || options.clearTimeoutFn
        || (timer => globalThis.clearTimeout(timer)),
    }
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

  withRegistrationTimeout(registrationPromise, signal) {
    return new Promise((resolve, reject) => {
      let timeout
      const finish = (callback, value) => {
        this.environment.registrationClearTimeoutFn(timeout)
        signal?.removeEventListener('abort', abort)
        callback(value)
      }
      const abort = () => finish(reject, signal.reason)
      signal?.addEventListener('abort', abort, { once: true })
      timeout = this.environment.registrationSetTimeoutFn(() => {
        finish(reject, new Error('Service worker registration timed out.'))
      }, this.options.registrationTimeoutMs)
      Promise.resolve(registrationPromise).then(
        value => finish(resolve, value),
        error => finish(reject, error),
      )
      if (signal?.aborted) abort()
    })
  }

  waitForExpectedServiceWorker(serviceWorker, signal) {
    return new Promise(resolve => {
      let timeout
      const finish = result => {
        signal?.removeEventListener('abort', abort)
        serviceWorker.removeEventListener('controllerchange', handleControllerChange)
        this.environment.clearTimeoutFn(timeout)
        resolve(result)
      }
      const handleControllerChange = () => {
        if (this.isExpectedServiceWorker(serviceWorker.controller)) finish(true)
      }

      const abort = () => finish(false)
      signal?.addEventListener('abort', abort, { once: true })
      serviceWorker.addEventListener('controllerchange', handleControllerChange)
      timeout = this.environment.setTimeoutFn(
        () => finish(false),
        this.options.upgradeTimeoutMs,
      )
      handleControllerChange()
      if (signal?.aborted) abort()
    })
  }

  async checkForServiceWorkerUpdate(registration) {
    try {
      await registration?.update?.()
    } catch (error) {
      // A transient update failure must not prevent the active worker from booting.
      console.warn('[Playground] Service Worker update check failed.', error)
    }
  }

  setupControllerChangeReload(serviceWorker, onReload) {
    let isInitialLoad = !serviceWorker.controller
    let isUpgradingLegacyWorker = !isInitialLoad
      && !this.isExpectedServiceWorker(serviceWorker.controller)
    let reloading = false

    const handleControllerChange = () => {
      if (isInitialLoad || isUpgradingLegacyWorker) {
        isInitialLoad = false
        isUpgradingLegacyWorker = false
      } else if (!reloading) {
        reloading = true
        console.log('[Playground] Service Worker updated! Auto-reloading to apply changes...')
        onReload()
      }
    }

    serviceWorker.addEventListener('controllerchange', handleControllerChange)
    return () => {
      serviceWorker.removeEventListener('controllerchange', handleControllerChange)
    }
  }
}
