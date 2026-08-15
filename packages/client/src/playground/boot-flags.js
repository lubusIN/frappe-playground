import { LOGIN_DEMO } from './config.js'
import { scopedFrameUrl } from './iframe-navigation.js'

const LOG_PREFIX = '[BootFlags]'

/**
 * Assert a fetch response is OK, throwing with the Frappe server error if not.
 */
async function assertResponse(res, action) {
  if (res.ok) return res
  let detail = `${res.status} ${res.statusText}`
  try {
    const body = await res.json()
    // Frappe wraps errors in exc_type / _server_messages
    const serverMsg = body._server_messages
      ? JSON.parse(body._server_messages)?.[0]
      : body.exc_type || body.message
    if (serverMsg) detail = `${detail} — ${serverMsg}`
  } catch (_) {}
  throw new Error(`${action} failed: ${detail}`)
}

/**
 * Process URL query parameters to configure the playground on boot.
 *
 * Supported params:
 *   - apps       Comma-separated app IDs to install (e.g. "crm,helpdesk")
 *   - login      "1" | "true" | "auto" — auto-login with demo credentials
 *   - onboarding "0" | "false" — auto-login + mark setup complete
 *   - path       Landing URL after boot (default: "/" or "/desk")
 *   - name       Playground instance name (handled by App.vue, not here)
 */
export async function processBootFlags(params, context) {
  const {
    playground,
    instanceId,
    installApp,
  } = context

  // 1. Process Apps Installation
  const appsParam = params.get('apps')
  if (appsParam) {
    const appsToInstall = appsParam.split(',').map(s => s.trim()).filter(Boolean)
    for (const appId of appsToInstall) {
      if (!playground.listInstalledApps().includes(appId)) {
        console.log(`${LOG_PREFIX} Installing app: ${appId}`)
        await installApp(appId)
        console.log(`${LOG_PREFIX} Installed app: ${appId}`)
      }
    }
  }

  // 2. Process Auto-Login & Skip Onboarding
  const skipOnboarding = ['0', 'false'].includes(params.get('onboarding'))
  const autoLogin = skipOnboarding || ['1', 'true', 'auto'].includes(params.get('login'))
  // Track CSRF token — extract from cookies set by the login response
  let csrfToken = ''

  if (autoLogin) {
    console.log(`${LOG_PREFIX} Auto-login as ${LOGIN_DEMO.username}`)
    const loginData = new FormData()
    loginData.append('usr', LOGIN_DEMO.username)
    loginData.append('pwd', LOGIN_DEMO.password)
    const loginRes = await fetch(scopedFrameUrl('/api/method/login', instanceId), {
      method: 'POST',
      body: loginData,
    })
    await assertResponse(loginRes, 'Auto-login')

    // Try to get CSRF from login response body (some Frappe versions include it)
    try {
      const loginBody = await loginRes.clone().json()
      console.log(`${LOG_PREFIX} Login response:`, loginBody)
    } catch (_) {}

    // Try to extract CSRF from document.cookie (set by service worker response)
    const cookieMatch = document.cookie.match(/csrf_token=([^;]+)/)
    if (cookieMatch) {
      csrfToken = cookieMatch[1]
    }

    console.log(`${LOG_PREFIX} Auto-login successful, CSRF from cookie:`, csrfToken ? 'yes' : 'no')
  }

  if (skipOnboarding) {
    console.log(`${LOG_PREFIX} Skipping onboarding`)

    // The Frappe boot process checks three different flags to determine if setup is complete.
    // Instead of raw SQL or set_value, we call the official setup_complete API which clears
    // caches, sets all flags, and runs all hooks properly for Frappe 16+.
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    if (csrfToken) {
      headers['X-Frappe-CSRF-Token'] = csrfToken
    }
    
    // Detect locale from browser
    const language = (navigator.language || 'en').split('-')[0]
    const regionCode = navigator.language?.split('-')[1]?.toUpperCase()
    let country = 'United States'
    
    try {
      // First try to detect country accurately via IP to avoid language mismatches (e.g. en-GB used in India)
      // Cache the result in localStorage to avoid querying the API on every boot
      const cachedCountry = localStorage.getItem('frappe_playground_country')
      if (cachedCountry) {
        country = cachedCountry
      } else {
        const geoRes = await fetch('https://get.geojs.io/v1/ip/country.json')
        if (geoRes.ok) {
          const geoData = await geoRes.json()
          if (geoData.name) {
            country = geoData.name
            localStorage.setItem('frappe_playground_country', country)
          }
        } else {
          // Fallback to browser language region parsing
          country = new Intl.DisplayNames(['en'], { type: 'region' }).of(regionCode) || country
        }
      }
    } catch (_) {}
    
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

    console.log(`${LOG_PREFIX} Detected locale: language=${language}, country=${country}, timeZone=${timeZone}`)

    const setupArgs = {
      language: language,
      timezone: timeZone,
      country: country,
      full_name: 'Administrator',
      email: 'admin@example.com',
      password: 'admin',
      first_name: 'Admin',
      last_name: 'User'
    }

    const setupRes = await fetch(scopedFrameUrl('/api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete', instanceId), {
      method: 'POST',
      headers,
      body: JSON.stringify({ args: setupArgs })
    })

    const setupBody = await setupRes.clone().json().catch(() => null)
    console.log(`${LOG_PREFIX} setup_complete API response:`, setupRes.status, setupBody)
    await assertResponse(setupRes, 'Skip onboarding (setup_complete API)')
    console.log(`${LOG_PREFIX} Official setup_complete API succeeded`)
  }

  // 3. Compute Initial Path
  let initialPath = params.get('path') || (autoLogin ? '/desk' : '/')
  if (initialPath === '/blank') initialPath = '/'
  
  return { initialPath, autoLogin, skipOnboarding }
}
