export function parseBootOptions(params) {
  const skipOnboarding = ['0', 'false'].includes(params.get('onboarding'))
  const autoLogin = skipOnboarding || ['1', 'true', 'auto'].includes(params.get('login'))
  const path = params.get('path') || (autoLogin ? '/desk' : '/')
  return {
    name: params.get('name') || undefined,
    createInstance: Boolean(params.get('onboarding') || params.get('apps')),
    apps: [...new Set((params.get('apps') || '').split(',').map(value => value.trim()).filter(Boolean))],
    skipOnboarding,
    autoLogin,
    initialPath: path === '/blank' ? '/' : path,
  }
}
