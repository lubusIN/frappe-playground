import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ProtocolMessageType,
  RuntimeStage,
  createRuntimeLogMessage,
  createRuntimeReadyMessage,
} from '../../packages/protocol/src/messages.js'
import {
  PlaygroundController,
  PlaygroundEventType,
} from '../../packages/client/src/playground/controller.js'
import {
  normalizeAddress,
  scopedFrameUrl,
  stripScope,
} from '../../packages/client/src/playground/iframe-navigation.js'
import {
  PLAYGROUND_SESSION_KEY,
  getOrCreateInstanceSession,
} from '../../packages/client/src/playground/session.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  }
}

test('instance sessions are created once and restored on reload', () => {
  const storage = memoryStorage()
  const options = { storage, cryptoApi: { randomUUID: () => 'instance-1' } }

  assert.deepEqual(getOrCreateInstanceSession(options), {
    id: 'instance-1',
    freshSession: true,
  })
  assert.equal(storage.getItem(PLAYGROUND_SESSION_KEY), 'instance-1')
  assert.deepEqual(getOrCreateInstanceSession(options), {
    id: 'instance-1',
    freshSession: false,
  })
})

test('iframe navigation scopes backend URLs without exposing scope in the address bar', () => {
  const origin = 'https://playground.example'
  assert.equal(normalizeAddress('desk?view=list#main', origin), '/desk?view=list#main')
  assert.equal(
    scopedFrameUrl('/desk?view=list#main', 'instance-1', origin),
    '/desk?view=list&__scope=instance-1#main',
  )
  assert.equal(
    stripScope('/desk?view=list&__scope=instance-1#main', origin),
    '/desk?view=list#main',
  )
})

test('the controller owns lifecycle wiring and emits structured progress', async () => {
  const serviceWorkerMessages = []
  const workerMessages = []
  let serviceWorkerUpdateChecks = 0
  const controllerWorker = {
    postMessage: (...args) => serviceWorkerMessages.push(args),
  }
  const serviceWorker = {
    controller: controllerWorker,
    addEventListener() {},
    removeEventListener() {},
    async register() {
      return {
        active: controllerWorker,
        async update() {
          serviceWorkerUpdateChecks += 1
        },
      }
    },
    ready: Promise.resolve({ active: controllerWorker }),
  }
  const documentListeners = new Map()
  const document = {
    visibilityState: 'visible',
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    removeEventListener: type => documentListeners.delete(type),
  }

  class FakeWorker {
    constructor(url, options) {
      this.url = url
      this.options = options
      FakeWorker.instance = this
    }
    postMessage(...args) {
      workerMessages.push(args)
    }
    terminate() {
      this.terminated = true
    }
  }

  class FakeMessageChannel {
    constructor() {
      this.port1 = { name: 'service-worker-port' }
      this.port2 = { name: 'server-port' }
    }
  }

  class FakeBroadcastChannel {
    close() {
      this.closed = true
    }
  }

  const controller = new PlaygroundController({
    navigator: { serviceWorker },
    document,
    location: { reload() {} },
    WorkerClass: FakeWorker,
    MessageChannelClass: FakeMessageChannel,
    BroadcastChannelClass: FakeBroadcastChannel,
    storage: memoryStorage(),
    cryptoApi: { randomUUID: () => 'instance-1' },
    setTimeoutFn: callback => {
      callback()
      return 1
    },
    clearTimeoutFn() {},
  })
  const progress = []
  const ready = []
  controller.on(PlaygroundEventType.PROGRESS, event => progress.push(event))
  controller.on(PlaygroundEventType.READY, event => ready.push(event))

  assert.deepEqual(await controller.start(), { id: 'instance-1', freshSession: true })
  assert.equal(serviceWorkerUpdateChecks, 1)
  assert.equal(FakeWorker.instance.options.type, 'module')
  assert.match(FakeWorker.instance.url, /^\/worker\.js\?v=2&scope=instance-1&fresh=true$/)
  assert.equal(serviceWorkerMessages[0][0].type, ProtocolMessageType.INIT_CHANNEL)
  assert.equal(workerMessages[0][0].type, ProtocolMessageType.INIT_CHANNEL)

  FakeWorker.instance.onmessage({
    data: createRuntimeLogMessage('Loading Pyodide...', RuntimeStage.PYTHON),
  })
  FakeWorker.instance.onmessage({ data: createRuntimeReadyMessage() })

  assert.equal(progress.some(event => event.stage === RuntimeStage.PYTHON), true)
  assert.deepEqual(ready, [{ instanceId: 'instance-1' }])

  controller.dispose()
  assert.equal(FakeWorker.instance.terminated, true)
  assert.equal(documentListeners.size, 0)
})

test('the controller waits for the versioned worker when a legacy worker controls the page', async () => {
  const listeners = new Set()
  const serviceWorker = {
    controller: { scriptURL: 'http://localhost:5173/sw.js' },
    addEventListener(type, listener) {
      if (type === 'controllerchange') listeners.add(listener)
    },
    removeEventListener(type, listener) {
      if (type === 'controllerchange') listeners.delete(listener)
    },
  }
  const controller = new PlaygroundController({
    location: { href: 'http://localhost:5173/' },
    setTimeoutFn: callback => setTimeout(callback, 100),
    clearTimeoutFn: clearTimeout,
  })

  assert.equal(controller.options.serviceWorkerUrl, '/sw.js?v=2')
  assert.equal(controller.isExpectedServiceWorker(serviceWorker.controller), false)

  const ready = controller.waitForExpectedServiceWorker(serviceWorker)
  serviceWorker.controller = { scriptURL: 'http://localhost:5173/sw.js?v=2' }
  for (const listener of [...listeners]) listener()

  assert.equal(await ready, true)
  assert.equal(listeners.size, 0)
})
