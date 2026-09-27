// Consumer-side acceptance ports use Core's public HTTP/WS boundary.
import WebSocket from 'ws'
import { once } from 'node:events'

export function settingsPort(baseUrl, token, request = fetch) {
  let device = {}
  const call = async (method, conversationId, patch, signal) => {
    const path = conversationId ? '/api/conversations/' + encodeURIComponent(conversationId) + '/settings' : '/api/chat/settings'
    const response = await request(baseUrl + path, { method, signal, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(patch ? { body: JSON.stringify(patch) } : {}) })
    const result = await response.json()
    if (!response.ok) throw Object.assign(Error('Settings HTTP ' + response.status), result, { status: response.status })
    return { ...result, device: { ...device } }
  }
  return { get: (id, signal) => call('GET', id, undefined, signal), patch: (patch, id, signal) => call('PATCH', patch.owner === 'account' ? undefined : id, patch, signal), getDevice: () => ({ ...device }), setDevice(values) { device = { ...device, ...values } } }
}

export function websocketPort(url) {
  let socket, state = 'disconnected'
  const listeners = new Set()
  const emit = event => { for (const listener of listeners) listener(event) }
  return {
    get state() { return state },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    send(message) { if (state !== 'ready') throw Error('Transport is not ready'); socket.send(JSON.stringify(message)) },
    async connect() {
      if (socket) throw Error('Disconnect before reconnecting')
      state = 'connecting'
      const current = socket = new WebSocket(url)
      current.on('message', bytes => emit({ type: 'message', message: JSON.parse(bytes.toString()) }))
      current.on('close', () => { if (socket === current) { state = 'disconnected'; socket = undefined; emit({ type: 'disconnected' }) } })
      try { await once(current, 'open'); state = 'ready'; emit({ type: 'ready' }) }
      catch (error) { state = 'disconnected'; socket = undefined; current.terminate(); throw error }
    },
    async disconnect() {
      const current = socket
      if (!current) return
      const closed = once(current, 'close'); current.close(); await closed
    },
    async dispose() { listeners.clear(); await this.disconnect() }
  }
}
