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
    query: typeof value.query === 'string' ? value.query : '',
    headers: requireObject(value.headers || {}, 'backend request headers'),
  }
  if (value.body !== undefined) payload.body = value.body
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
    headers: value.headers || {},
    body: value.body,
  })
}

export function readBackendResponse(value) {
  const protocolMessage = assertProtocolMessage(value, ProtocolMessageType.BACKEND_RESPONSE)
  return createBackendResponse(protocolMessage.payload).payload
}
