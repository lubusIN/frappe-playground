export function shouldPersistRequest(request, response) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true
  const headers = Array.isArray(response.headers)
    ? response.headers
    : Object.entries(response.headers || {})
  return headers.some(([name]) => name.toLowerCase() === 'set-cookie')
}

export class SerialRequestExecutor {
  constructor({
    handleRequest,
    persist,
    decodeRequest,
    encodeResponse,
    encodeError,
    schedule = callback => setTimeout(callback, 0),
    logger = console,
  }) {
    this.handleRequest = handleRequest
    this.persist = persist
    this.decodeRequest = decodeRequest
    this.encodeResponse = encodeResponse
    this.encodeError = encodeError
    this.schedule = schedule
    this.logger = logger
    this.queue = []
    this.processing = false
  }

  attach(port) {
    port.onmessage = event => {
      this.queue.push({
        request: this.decodeRequest(event.data),
        responsePort: event.ports[0],
      })
      this.processNext()
    }
  }

  async processNext() {
    if (this.processing || this.queue.length === 0) return
    this.processing = true
    const { request, responsePort } = this.queue.shift()
    try {
      const response = await this.handleRequest(request)
      if (shouldPersistRequest(request, response)) await this.persist()
      this.logger.log(`[Worker] Handled request: ${request.path} -> ${response.status}`)
      responsePort.postMessage(this.encodeResponse(response))
    } catch (error) {
      responsePort.postMessage(this.encodeError(error))
    } finally {
      this.processing = false
      this.schedule(() => this.processNext())
    }
  }
}
