export const PLAYGROUND_POLYFILLS_DIR = '/home/pyodide/playground_polyfills'

export class PythonBridge {
  constructor({ pyodide, mocksSource, wsgiSource, cookieJarJson, mariadbPolyfillsSource }) {
    this.pyodide = pyodide
    this.mocksSource = mocksSource
    this.wsgiSource = wsgiSource
    this.cookieJarJson = cookieJarJson
    this.mariadbPolyfillsSource = mariadbPolyfillsSource
  }

  async configure() {
    if (this.mariadbPolyfillsSource) {
      this.pyodide.FS.mkdirTree(PLAYGROUND_POLYFILLS_DIR)
      this.pyodide.FS.writeFile(`${PLAYGROUND_POLYFILLS_DIR}/mariadb_polyfills.py`, this.mariadbPolyfillsSource)
    }

    await this.pyodide.runPythonAsync(this.mocksSource)

    if (this.mariadbPolyfillsSource) {
      await this.pyodide.runPythonAsync(`
import sys
if '${PLAYGROUND_POLYFILLS_DIR}' not in sys.path:
    sys.path.insert(0, '${PLAYGROUND_POLYFILLS_DIR}')
import mariadb_polyfills
mariadb_polyfills.install()
      `)
    }

    await this.pyodide.runPythonAsync(this.wsgiSource)
    if (this.cookieJarJson) {
      this.pyodide.globals.set('temp_cookie_json', this.cookieJarJson)
      await this.pyodide.runPythonAsync(`
import json
_handler.cookie_jar = json.loads(temp_cookie_json)
del temp_cookie_json
      `)
    }
  }

  handleRequest(request) {
    const requestMap = new Map(Object.entries(request))
    if (request.headers) requestMap.set('headers', new Map(Object.entries(request.headers)))
    const pythonRequest = this.pyodide.toPy(requestMap)
    let pythonResponse
    try {
      this.pyodide.globals.set('current_req', pythonRequest)
      pythonResponse = this.pyodide.runPython('handle_request(current_req)')
      return pythonResponse.toJs({ dict_converter: Object.fromEntries })
    } finally {
      this.pyodide.globals.delete?.('current_req')
      pythonRequest.destroy()
      pythonResponse?.destroy()
    }
  }

  async exportCookieJar() {
    try {
      return await this.pyodide.runPythonAsync(`
import json
json.dumps(_handler.cookie_jar)
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

  // One queue owns every operation that reads or changes the Python runtime.
  enqueue(operation) {
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject })
      this.processNext()
    })
  }

  attach(port) {
    this.port?.close?.()
    if (this.port) this.port.onmessage = null
    this.port = port
    port.onmessage = async event => {
      const responsePort = event.ports?.[0]
      if (!responsePort || typeof responsePort.postMessage !== 'function') return
      try {
        const request = this.decodeRequest(event.data)
        const response = await this.enqueue(async () => {
          const response = await this.handleRequest(request)
          if (shouldPersistRequest(request, response)) await this.persist()
          this.logger.log(`[Worker] Handled request: ${request.path} -> ${response.status}`)
          return response
        })
        responsePort.postMessage(this.encodeResponse(response))
      } catch (error) {
        responsePort.postMessage(this.encodeError(error))
      } finally {
        responsePort.close?.()
      }
    }
  }

  async processNext() {
    if (this.processing || this.queue.length === 0) return
    this.processing = true
    const { operation, resolve, reject } = this.queue.shift()
    try {
      resolve(await operation())
    } catch (error) {
      reject(error)
    } finally {
      this.processing = false
      this.schedule(() => this.processNext())
    }
  }
}
