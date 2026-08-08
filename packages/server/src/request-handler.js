export class PythonBridge {
  constructor({ pyodide, mocksSource, wsgiSource, cookieJarJson }) {
    this.pyodide = pyodide
    this.mocksSource = mocksSource
    this.wsgiSource = wsgiSource
    this.cookieJarJson = cookieJarJson
  }

  async configure() {
    await this.pyodide.runPythonAsync(this.mocksSource)
    await this.pyodide.runPythonAsync(this.wsgiSource)
    if (this.cookieJarJson) {
      this.pyodide.globals.set('temp_cookie_json', this.cookieJarJson)
      await this.pyodide.runPythonAsync(`
import json
_cookie_jar = json.loads(temp_cookie_json)
del temp_cookie_json
      `)
    }
  }

  handleRequest(request) {
    const requestMap = new Map(Object.entries(request))
    if (request.headers) requestMap.set('headers', new Map(Object.entries(request.headers)))
    const pythonRequest = this.pyodide.toPy(requestMap)
    this.pyodide.globals.set('current_req', pythonRequest)
    const pythonResponse = this.pyodide.runPython('handle_request(current_req)')
    try {
      return pythonResponse.toJs({ dict_converter: Object.fromEntries })
    } finally {
      pythonRequest.destroy()
      pythonResponse.destroy()
    }
  }

  async exportCookieJar() {
    try {
      return await this.pyodide.runPythonAsync(`
import json
json.dumps(globals().get('_cookie_jar', {}))
      `)
    } catch (_) {
      return '{}'
    }
  }
}

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
