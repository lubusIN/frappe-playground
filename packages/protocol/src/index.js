export const PROTOCOL_VERSION = 2

export const ProtocolMessageType = Object.freeze({
  CLAIM_CLIENTS: 'service-worker:claim-clients',
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

function message(type, payload) {
  const result = { protocolVersion: PROTOCOL_VERSION, type }
  if (payload !== undefined) result.payload = payload
  return result
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

function requireString(value, label) {
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
  return message(ProtocolMessageType.CLAIM_CLIENTS)
}

export function createClearOtherInstancesMessage(scope) {
  return message(ProtocolMessageType.CLEAR_OTHER_INSTANCES, {
    scope: requireString(scope, 'scope'),
  })
}

export function createInitChannelMessage(scope, options = {}) {
  const payload = { scope: requireString(scope, 'scope') }
  if ('freshSession' in options) payload.freshSession = options.freshSession === true
  return message(ProtocolMessageType.INIT_CHANNEL, payload)
}

export function createRecoveryRequestMessage() {
  return message(ProtocolMessageType.RECOVERY_REQUEST)
}

export function createRuntimeLogMessage(text, stage, status = 'active') {
  if (!runtimeStages.has(stage)) throw new TypeError('runtime stage is invalid')
  if (!progressStatuses.has(status)) throw new TypeError('runtime progress status is invalid')
  return message(ProtocolMessageType.RUNTIME_LOG, {
    message: requireString(text, 'message'),
    stage,
    status,
  })
}

export function createRuntimeReadyMessage() {
  return message(ProtocolMessageType.RUNTIME_READY)
}

export function createRuntimeErrorMessage(text) {
  return message(ProtocolMessageType.RUNTIME_ERROR, {
    message: requireString(text, 'message'),
  })
}

export function createBackendRequest(request) {
  const value = requireObject(request, 'backend request')
  const payload = {
    method: requireString(value.method, 'backend request method'),
    path: requireString(value.path, 'backend request path'),
    query: typeof value.query === 'string' ? value.query : '',
    headers: requireObject(value.headers || {}, 'backend request headers'),
  }
  if (value.body !== undefined) payload.body = value.body
  return message(ProtocolMessageType.BACKEND_REQUEST, payload)
}

export function readBackendRequest(value) {
  const protocolMessage = assertProtocolMessage(value, ProtocolMessageType.BACKEND_REQUEST)
  return createBackendRequest(protocolMessage.payload).payload
}

export function createBackendResponse(response) {
  const value = requireObject(response, 'backend response')
  if (!Number.isInteger(value.status) || value.status < 100 || value.status > 599) {
    throw new TypeError('backend response status must be an HTTP status code')
  }
  return message(ProtocolMessageType.BACKEND_RESPONSE, {
    status: value.status,
    headers: value.headers || {},
    body: value.body,
  })
}

export function readBackendResponse(value) {
  const protocolMessage = assertProtocolMessage(value, ProtocolMessageType.BACKEND_RESPONSE)
  return createBackendResponse(protocolMessage.payload).payload
}
