import assert from 'node:assert/strict'
import { MessageChannel } from 'node:worker_threads'
import test from 'node:test'

import {
  PROTOCOL_VERSION,
  ProtocolMessageType,
  RuntimeStage,
  assertProtocolMessage,
  createBackendRequest,
  createBackendResponse,
  createClearOtherInstancesMessage,
  createInitChannelMessage,
  createRuntimeErrorMessage,
  createRuntimeLogMessage,
  createRuntimeReadyMessage,
  isProtocolMessage,
  readBackendRequest,
  readBackendResponse,
} from '../../packages/protocol/src/index.js'

test('control and runtime messages use the current protocol version', () => {
  const messages = [
    createInitChannelMessage('instance-1', { freshSession: true }),
    createClearOtherInstancesMessage('instance-1'),
    createRuntimeLogMessage('Loading Pyodide...', RuntimeStage.PYTHON),
    createRuntimeReadyMessage(),
    createRuntimeErrorMessage('Boot failed'),
  ]

  for (const value of messages) {
    assert.equal(value.protocolVersion, PROTOCOL_VERSION)
    assert.equal(isProtocolMessage(value), true)
  }
  assert.equal(messages[0].type, ProtocolMessageType.INIT_CHANNEL)
  assert.deepEqual(messages[0].payload, { scope: 'instance-1', freshSession: true })
})

test('messages from another or missing protocol version are rejected', () => {
  assert.equal(isProtocolMessage({ type: ProtocolMessageType.RUNTIME_READY }), false)
  assert.equal(
    isProtocolMessage({ protocolVersion: PROTOCOL_VERSION + 1, type: ProtocolMessageType.RUNTIME_READY }),
    false,
  )
  assert.throws(
    () => assertProtocolMessage({ protocolVersion: 99, type: ProtocolMessageType.RUNTIME_READY }),
    new RegExp(`Expected protocol v${PROTOCOL_VERSION}`),
  )
})

test('backend request envelopes preserve transferable bodies', () => {
  const body = new Uint8Array([1, 2, 3]).buffer
  const envelope = createBackendRequest({
    method: 'POST',
    path: '/api/method/upload_file',
    query: 'private=0',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  })

  assert.equal(envelope.type, ProtocolMessageType.BACKEND_REQUEST)
  assert.deepEqual(readBackendRequest(envelope), {
    method: 'POST',
    path: '/api/method/upload_file',
    query: 'private=0',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  })
})

test('backend responses validate HTTP status codes', () => {
  const envelope = createBackendResponse({
    status: 200,
    headers: [['content-type', 'application/json']],
    body: '{}',
  })

  assert.deepEqual(readBackendResponse(envelope), {
    status: 200,
    headers: [['content-type', 'application/json']],
    body: '{}',
  })
  assert.throws(() => createBackendResponse({ status: 42 }), /HTTP status code/)
})

test('protocol envelopes survive a MessageChannel structured clone', async () => {
  const channel = new MessageChannel()
  const received = new Promise(resolve => channel.port2.once('message', resolve))
  channel.port1.postMessage(createRuntimeLogMessage('Starting Frappe', RuntimeStage.FRAPPE))

  assert.deepEqual(
    await received,
    createRuntimeLogMessage('Starting Frappe', RuntimeStage.FRAPPE),
  )
  channel.port1.close()
  channel.port2.close()
})
