export const PYODIDE_BASE_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.0/full/'

export async function initializePyodide({
  globalScope,
  fetchFn,
  pythonPackages,
  log,
  baseUrl = PYODIDE_BASE_URL,
}) {
  log('Loading Pyodide...')
  if (!globalScope.loadPyodide) {
    const loaderUrl = `${baseUrl}pyodide.js`
    const response = await fetchFn(loaderUrl, { mode: 'cors' })
    if (!response.ok) {
      throw new Error(`Failed to fetch ${loaderUrl}: ${response.status} ${response.statusText}`)
    }
    globalScope.eval(`${await response.text()}\n//# sourceURL=${loaderUrl}`)
    if (!globalScope.loadPyodide) {
      throw new Error('Pyodide CDN loader did not expose loadPyodide.')
    }
  }

  const pyodide = await globalScope.loadPyodide({ indexURL: baseUrl })
  await pyodide.runPythonAsync(`
import warnings
warnings.filterwarnings("ignore", category=SyntaxWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)
  `)

  log('Loading core packages...')
  await pyodide.loadPackage(['micropip', 'cryptography', 'tzdata'])
  log('Installing Python dependencies...')
  await pyodide.pyimport('micropip').install(pythonPackages, { keep_going: true })
  return pyodide
}
