import WebSocket from 'ws'
import { createChatClient, createServerChatCredentialAdapter } from '@sislexa/sdk'

/** Server-side synthetic consumer; no credentials in URLs or browser storage. */
export function createSyntheticChatApplication({ enabled = false, baseUrl, conversationId, credential,
  fetchImpl = fetch, connectSocket = (url, options) => new WebSocket(url, options) }) {
  if (enabled !== true) throw Error('synthetic_application_disabled')
  if (!conversationId) throw Error('conversation_required')
  const headers = createServerChatCredentialAdapter({ credential, header: 'x-sislexa-delegation', scheme: '' })
  return createChatClient({
    baseUrl, headers, reconnect: { maxAttempts: 0 },
    fetch: async (url, init) => {
      const scoped = new URL(url)
      if (scoped.pathname === '/api/chat/context') scoped.searchParams.set('conversationId', conversationId)
      const response = await fetchImpl(scoped, init)
      // Core's scoped endpoint returns the complete connection snapshot; A05's
      // capability port consumes the contained context.
      if (scoped.pathname === '/api/chat/context' && response.ok) {
        const snapshot = await response.json()
        return Response.json(snapshot.context, { status: response.status })
      }
      return response
    },
    createSocket(url) {
      const socket = connectSocket(url, { headers: { 'x-sislexa-delegation': credential } })
      // A05 exposes a host socket adapter, but has no conversation handshake option.
      const send = socket.send.bind(socket)
      socket.send = data => {
        const message = JSON.parse(String(data))
        send(JSON.stringify(message.t === 'chat.connect' ? { ...message, conversationId } : message))
      }
      return socket
    },
    async resynchronize(_snapshot, signal) {
      const response = await fetchImpl(new URL('/api/conversations/' + encodeURIComponent(conversationId), baseUrl), {
        headers: await headers(signal), signal, redirect: 'error'
      })
      if (!response.ok) throw Error('synthetic_resynchronization_failed')
      await response.json()
    }
  })
}
