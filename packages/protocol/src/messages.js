import { PROTOCOL_VERSION } from './version.js'

export { PROTOCOL_VERSION }

export const ProtocolMessageType = Object.freeze({
  CLAIM_CLIENTS: 'service-worker:claim-clients',
  ASSOCIATE_CLIENT: 'service-worker:associate-client',
  CLEAR_OTHER_INSTANCES: 'service-worker:clear-other-instances',
  INIT_CHANNEL: 'channel:init',
  CLOSE_CHANNEL: 'channel:close',
  RECOVERY_REQUEST: 'channel:recovery-request',
  RUNTIME_LOG: 'runtime:log',
  RUNTIME_READY: 'runtime:ready',
  RUNTIME_ERROR: 'runtime:error',
  APP_INSTALL: 'app:install',
  APP_INSTALL_RESULT: 'app:install-result',
  APP_UNINSTALL: 'app:uninstall',
  APP_UNINSTALL_RESULT: 'app:uninstall-result',
  BACKEND_REQUEST: 'backend:request',
  BACKEND_RESPONSE: 'backend:response',
})

export const RuntimeStage = Object.freeze({
  SERVICE_WORKER: 'service-worker',
  PYTHON: 'python',
  RUNTIME: 'runtime',
  DATABASE: 'database',
  FRAPPE: 'frappe',
})

const runtimeStages = new Set(Object.values(RuntimeStage))
const progressStatuses = new Set(['active', 'done'])

export function createMessage(type, payload) {
  const result = { protocolVersion: PROTOCOL_VERSION, type }
  if (payload !== undefined) result.payload = payload
  return result
}

export function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

export function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

export function isProtocolMessage(value, type) {
  return Boolean(
    value
      && typeof value === 'object'
      && value.protocolVersion === PROTOCOL_VERSION
      && typeof value.type === 'string'
      && (type === undefined || value.type === type),
  )
}

export function assertProtocolMessage(value, type) {
  if (!isProtocolMessage(value, type)) {
    const expected = type ? ` ${type}` : ''
    throw new TypeError(`Expected protocol v${PROTOCOL_VERSION}${expected} message`)
  }
  return value
}

export function createClaimClientsMessage() {
  // Deprecated: activation owns clients.claim(). Retained for protocol-v2
  // compatibility so older messages remain recognizable and can be ignored.
  return createMessage(ProtocolMessageType.CLAIM_CLIENTS)
}

export function createAssociateClientMessage(scope) {
  return createMessage(ProtocolMessageType.ASSOCIATE_CLIENT, {
    scope: requireString(scope, 'scope'),
  })
}

export function createClearOtherInstancesMessage(scope) {
  // Deprecated: retained only so protocol-v2 clients can be parsed safely.
  // A service worker is shared across tabs, making cross-instance eviction
  // unsafe for the multi-playground model.
  return createMessage(ProtocolMessageType.CLEAR_OTHER_INSTANCES, {
    scope: requireString(scope, 'scope'),
  })
}

export function createInitChannelMessage(scope, options = {}) {
  const payload = { scope: requireString(scope, 'scope') }
  if ('freshSession' in options) payload.freshSession = options.freshSession === true
  return createMessage(ProtocolMessageType.INIT_CHANNEL, payload)
}

export function createCloseChannelMessage(scope) {
  return createMessage(ProtocolMessageType.CLOSE_CHANNEL, {
    scope: requireString(scope, 'scope'),
  })
}

export function createRecoveryRequestMessage() {
  return createMessage(ProtocolMessageType.RECOVERY_REQUEST)
}

export function createRuntimeLogMessage(text, stage, status = 'active') {
  if (!runtimeStages.has(stage)) throw new TypeError('runtime stage is invalid')
  if (!progressStatuses.has(status)) throw new TypeError('runtime progress status is invalid')
  return createMessage(ProtocolMessageType.RUNTIME_LOG, {
    message: requireString(text, 'message'),
    stage,
    status,
  })
}

export function createRuntimeReadyMessage(options = {}) {
  if (!('installedApps' in options)) return createMessage(ProtocolMessageType.RUNTIME_READY)
  if (!Array.isArray(options.installedApps)
    || options.installedApps.some(appId => typeof appId !== 'string' || !appId)) {
    throw new TypeError('installedApps must be an array of strings')
  }
  return createMessage(ProtocolMessageType.RUNTIME_READY, {
    installedApps: [...new Set(options.installedApps)],
  })
}

export function createRuntimeErrorMessage(text) {
  return createMessage(ProtocolMessageType.RUNTIME_ERROR, {
    message: requireString(text, 'message'),
  })
}

export function createAppInstallMessage(requestId, appId) {
  return createMessage(ProtocolMessageType.APP_INSTALL, {
    requestId: requireString(requestId, 'requestId'),
    appId: requireString(appId, 'appId'),
  })
}

export function createAppInstallResultMessage(requestId, appId, options = {}) {
  const payload = {
    requestId: requireString(requestId, 'requestId'),
    appId: requireString(appId, 'appId'),
    installed: options.installed === true,
  }
  if (options.error) payload.error = requireString(options.error, 'error')
  return createMessage(ProtocolMessageType.APP_INSTALL_RESULT, payload)
}

export function createAppUninstallMessage(requestId, appId) {
  return createMessage(ProtocolMessageType.APP_UNINSTALL, {
    requestId: requireString(requestId, 'requestId'),
    appId: requireString(appId, 'appId'),
  })
}

export function createAppUninstallResultMessage(requestId, appId, options = {}) {
  const payload = {
    requestId: requireString(requestId, 'requestId'),
    appId: requireString(appId, 'appId'),
    uninstalled: options.uninstalled === true,
  }
  if (options.error) payload.error = requireString(options.error, 'error')
  return createMessage(ProtocolMessageType.APP_UNINSTALL_RESULT, payload)
}

// Validate untrusted control payloads before consumers read fields or mutate state.
// Keep isProtocolMessage as the envelope predicate for backend request readers.
export function isControlMessage(value, type) {
  if (!isProtocolMessage(value, type)) return false
  const payload = value.payload
  const string = field => typeof payload?.[field] === 'string' && payload[field].length > 0
  const object = payload && typeof payload === 'object' && !Array.isArray(payload)
  switch (value.type) {
    case ProtocolMessageType.CLAIM_CLIENTS:
    case ProtocolMessageType.RECOVERY_REQUEST:
      return payload === undefined || Boolean(object)
    case ProtocolMessageType.RUNTIME_READY:
      return payload === undefined || Boolean(object && (payload.installedApps === undefined
        || (Array.isArray(payload.installedApps)
          && payload.installedApps.every(app => typeof app === 'string' && app.length > 0))))
    case ProtocolMessageType.INIT_CHANNEL:
      return Boolean(object && string('scope')
        && (payload.freshSession === undefined || typeof payload.freshSession === 'boolean')
        && (payload.clientId === undefined || string('clientId')))
    case ProtocolMessageType.ASSOCIATE_CLIENT:
    case ProtocolMessageType.CLOSE_CHANNEL:
    case ProtocolMessageType.CLEAR_OTHER_INSTANCES:
      return Boolean(object && string('scope'))
    case ProtocolMessageType.RUNTIME_ERROR:
      return Boolean(object && string('message'))
    case ProtocolMessageType.RUNTIME_LOG:
      return Boolean(object && string('message') && runtimeStages.has(payload.stage)
        && progressStatuses.has(payload.status))
    case ProtocolMessageType.APP_INSTALL:
    case ProtocolMessageType.APP_UNINSTALL:
      return Boolean(object && string('requestId') && string('appId'))
    case ProtocolMessageType.APP_INSTALL_RESULT:
    case ProtocolMessageType.APP_UNINSTALL_RESULT: {
      const field = value.type === ProtocolMessageType.APP_INSTALL_RESULT ? 'installed' : 'uninstalled'
      return Boolean(object && string('requestId') && string('appId')
        && typeof payload[field] === 'boolean' && (payload.error === undefined || string('error')))
    }
    default:
      return false
  }
}

export function hasMessagePort(event) {
  const port = event.ports?.[0]
  return Boolean(port && typeof port.postMessage === 'function' && typeof port.close === 'function')
}
