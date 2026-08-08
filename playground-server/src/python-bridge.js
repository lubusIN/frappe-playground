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
