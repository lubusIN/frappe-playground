import { PROTOCOL_VERSION } from './version.js'

export { PROTOCOL_VERSION }

export const ProtocolMessageType = Object.freeze({
  CLAIM_CLIENTS: 'service-worker:claim-clients',
  ASSOCIATE_CLIENT: 'service-worker:associate-client',
  CLEAR_OTHER_INSTANCES: 'service-worker:clear-other-instances',
  INIT_CHANNEL: 'channel:init',
  RECOVERY_REQUEST: 'channel:recovery-request',
  RUNTIME_LOG: 'runtime:log',
  RUNTIME_READY: 'runtime:ready',
  RUNTIME_ERROR: 'runtime:error',
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

export function createRuntimeReadyMessage() {
  return createMessage(ProtocolMessageType.RUNTIME_READY)
}

export function createRuntimeErrorMessage(text) {
  return createMessage(ProtocolMessageType.RUNTIME_ERROR, {
    message: requireString(text, 'message'),
  })
}
