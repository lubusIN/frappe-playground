import {
  ProtocolMessageType,
  assertProtocolMessage,
  createMessage,
  requireObject,
  requireString,
} from './messages.js'

export function createBackendRequest(request) {
  const value = requireObject(request, 'backend request')
  const payload = {
    method: requireString(value.method, 'backend request method'),
    path: requireString(value.path, 'backend request path'),
    query: value.query === undefined ? '' : requireQuery(value.query),
    headers: requireHeaders(value.headers ?? {}, false),
  }
  if (value.body !== undefined) payload.body = requireBody(value.body)
  return createMessage(ProtocolMessageType.BACKEND_REQUEST, payload)
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
  return createMessage(ProtocolMessageType.BACKEND_RESPONSE, {
    status: value.status,
    headers: requireHeaders(value.headers ?? {}, true),
    body: requireBody(value.body),
  })
}

export function readBackendResponse(value) {
  const protocolMessage = assertProtocolMessage(value, ProtocolMessageType.BACKEND_RESPONSE)
  return createBackendResponse(protocolMessage.payload).payload
}

function requireQuery(value) {
  if (typeof value !== 'string') throw new TypeError('backend query must be a string')
  return value
}

function requireHeaders(value, allowPairs) {
  if (allowPairs && Array.isArray(value)) {
    if (value.some(pair => !Array.isArray(pair) || pair.length !== 2
      || typeof pair[0] !== 'string' || typeof pair[1] !== 'string')) {
      throw new TypeError('backend headers must contain string pairs')
    }
  } else {
    requireObject(value, 'backend headers')
    if (Object.values(value).some(header => typeof header !== 'string')) {
      throw new TypeError('backend header values must be strings')
    }
  }
  return value
}

function requireBody(value) {
  if (value == null || typeof value === 'string' || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value
  throw new TypeError('backend body must be text or binary data')
}
