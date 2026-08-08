export function isSocketIoPath(pathname) {
  return pathname.startsWith('/socket.io/')
}

export function handleSocketIoRequest(request, url) {
  if (request.method === 'POST') return new Response('ok', { status: 200 })

  if (!url.searchParams.has('sid')) {
    const handshake = '0{"sid":"mock-sid-123","upgrades":[],"pingInterval":25000,"pingTimeout":5000}'
    return new Response(handshake, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return new Promise(() => {})
}
