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

  let pyodide
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      pyodide = await globalScope.loadPyodide({ indexURL: baseUrl })
      break
    } catch (err) {
      if (attempt < 3) {
        log(`Pyodide load failed, retrying (attempt ${attempt + 1}/3)...`)
        await new Promise(r => setTimeout(r, 1000 * attempt))
        continue
      }
      throw err
    }
  }
  await pyodide.runPythonAsync(String.raw`
import warnings
# Compilation warnings use the source filename, not the imported module name.
for _category in (SyntaxWarning, DeprecationWarning):
    warnings.filterwarnings(
        "ignore", message=r".*invalid escape sequence", category=_category,
        module=r"^(?:whoosh(?:\.|$)|.*/site-packages/whoosh/)",
    )
del _category

# Fix Pyodide 314 AbortError AttributeError when fetch fails without an AbortSignal
try:
    import pyodide.http
    import pyodide.http._exceptions
    import pyodide.http._pyfetch
    import asyncio

    def _safe_abort_init(self, reason=None):
        msg = getattr(reason, "message", None) if reason is not None else "fetch aborted"
        Exception.__init__(self, msg or str(reason))
    pyodide.http._exceptions.AbortError.__init__ = _safe_abort_init

    _orig_pyfetch = pyodide.http.pyfetch
    async def _resilient_pyfetch(url, **kwargs):
        for _attempt in range(5):
            try:
                resp = await asyncio.wait_for(_orig_pyfetch(url, **kwargs), timeout=30.0)
                if getattr(resp, "status", None) == 429:
                    if _attempt < 4:
                        await asyncio.sleep(2 * (_attempt + 1))
                        continue
                return resp
            except Exception as _err:
                if _attempt < 4:
                    await asyncio.sleep(1 + _attempt)
                    continue
                raise
    pyodide.http.pyfetch = _resilient_pyfetch
    pyodide.http._pyfetch.pyfetch = _resilient_pyfetch
except Exception:
    pass
  `)

  log('Loading core packages...')
  await pyodide.loadPackage(['micropip', 'cryptography', 'tzdata'])
  await pyodide.runPythonAsync(String.raw`
# Ensure micropip uses resilient pyfetch and fetch_bytes
try:
    import micropip._compat._compat_in_pyodide as _compat
    import asyncio
    _compat.pyfetch = pyodide.http.pyfetch

    _orig_fetch_bytes = _compat.fetch_bytes
    async def _resilient_fetch_bytes(url, kwargs):
        for _attempt in range(4):
            try:
                return await asyncio.wait_for(_orig_fetch_bytes(url, kwargs), timeout=90.0)
            except Exception:
                if _attempt < 3:
                    await asyncio.sleep(2 * (_attempt + 1))
                    continue
                raise
    _compat.fetch_bytes = _resilient_fetch_bytes
except Exception:
    pass
  `)

  log('Installing Python dependencies...')
  const micropip = pyodide.pyimport('micropip')
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await micropip.install(pythonPackages, { keep_going: true })
      break
    } catch (err) {
      if (attempt < 3 && err?.message?.includes?.("Can't find a pure Python 3 wheel")) {
        log(`Retrying package resolution (attempt ${attempt + 1}/3)...`)
        await new Promise(r => setTimeout(r, 2000 * attempt))
        continue
      }
      throw err
    }
  }
  return pyodide
}
