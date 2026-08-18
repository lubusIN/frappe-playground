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
# Whoosh emits invalid-escape-sequence SyntaxWarnings on Python 3.12+ (confirmed
# on 3.14 at whoosh/analysis/intraword.py:285). A blanket category filter used to
# hide these for every package, including Frappe, which masks real deprecations.
#
# Match on the message rather than the module: a compile-time SyntaxWarning is
# attributed to the importing context, not to the module being compiled, so
# module=r"whoosh.*" silently fails to match.
warnings.filterwarnings("ignore", category=SyntaxWarning, message=r".*invalid escape sequence.*")
warnings.filterwarnings("ignore", category=DeprecationWarning, module=r"whoosh.*")
  `)

  log('Loading core packages...')
  await pyodide.loadPackage(['micropip', 'cryptography', 'tzdata'])
  log('Installing Python dependencies...')
  await pyodide.pyimport('micropip').install(pythonPackages, { keep_going: true })
  return pyodide
}
