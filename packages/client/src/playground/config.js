// Client-only presentation defaults. Server runtime configuration belongs in
// packages/server/src/config.js and must not be imported by the Vue shell.
export const LOGIN_DEMO = Object.freeze({
  prefill: true,
  username: 'Administrator',
  password: 'admin',
})
