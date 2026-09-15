import { LOGIN_DEMO } from './config.js'
import { parseBootOptions } from './boot-options.js'
import { createSiteApi } from './site-api.js'
import { resolveBootLocale } from './boot-locale.js'

const LOG_PREFIX = '[BootFlags]'

/**
 * Process URL query parameters to configure the playground on boot.
 *
 * Supported params:
 *   - apps       Comma-separated app IDs to install (e.g. "crm,helpdesk")
 *   - login      "1" | "true" | "auto" — auto-login with demo credentials
 *   - onboarding "0" | "false" — auto-login + mark setup complete
 *   - path       Landing URL after boot (default: "/" or "/desk")
 *   - name       Playground instance name (handled by useInstanceManager)
 */
export async function processBootFlags(params, context) {
  const {
    playground,
    instanceId,
    installApp,
    signal,
  } = context

  signal?.throwIfAborted()

  const { apps, autoLogin, skipOnboarding, initialPath } = parseBootOptions(params)
  const request = createSiteApi({ instanceId, signal })
  for (const appId of apps) {
    signal?.throwIfAborted()
    if (!playground.listInstalledApps().includes(appId)) await installApp(appId)
  }
  // Track CSRF token — extract from cookies set by the login response
  let csrfToken = ''

  if (autoLogin) {
    console.log(`${LOG_PREFIX} Auto-login as ${LOGIN_DEMO.username}`)
    const loginData = new FormData()
    loginData.append('usr', LOGIN_DEMO.username)
    loginData.append('pwd', LOGIN_DEMO.password)
    await request('/api/method/login', {
      method: 'POST',
      body: loginData,
    }, 'Auto-login')

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

    const { language, country, timeZone } = await resolveBootLocale({ signal })

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

    await request('/api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ args: setupArgs })
    }, 'Skip onboarding (setup_complete API)')

    console.log(`${LOG_PREFIX} Official setup_complete API succeeded`)
  }

  signal?.throwIfAborted()

  return { initialPath, autoLogin, skipOnboarding }
}
