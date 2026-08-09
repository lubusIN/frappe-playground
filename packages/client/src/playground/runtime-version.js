export const RUNTIME_BUILD_ID = import.meta.env?.VITE_PLAYGROUND_RUNTIME_BUILD_ID || 'test'

export function runtimeEntryUrl(pathname, buildId = RUNTIME_BUILD_ID) {
  const url = new URL(pathname, 'https://playground.invalid')
  url.searchParams.set('build', buildId)
  return `${url.pathname}${url.search}`
}
