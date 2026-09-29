import { createBrowserChatSession, createChatClient } from '/sdk/index.js'

const views = new Set()
const status = document.querySelector('#status')
const coreInput = document.querySelector('[name=core]')
coreInput.value = new URLSearchParams(location.search).get('core') ?? ''

/** A public-client host may supply Identity E03's memory-only accessToken callback. */
export function connectExternalChat(baseUrl, conversationId, delegatedAccessToken) {
  const base = new URL(baseUrl)
  if (!['http:', 'https:'].includes(base.protocol) || base.origin !== baseUrl) throw Error('Enter an exact Core origin')
  const credentials = delegatedAccessToken ? 'omit' : 'include'
  const fetchSession = async (input, init) => {
    const url = new URL(input)
    const headers = new Headers(init?.headers)
    if (delegatedAccessToken && url.pathname === '/api/chat/session') {
      headers.set('authorization', 'Bearer ' + await delegatedAccessToken(init.signal))
      url.searchParams.set('conversationId', conversationId)
    }
    return fetch(url, { ...init, headers, credentials })
  }
  const session = createBrowserChatSession({ baseUrl, credentials, fetch: fetchSession })
  const panel = document.createElement('section')
  panel.setAttribute('aria-label', 'Conversation ' + conversationId)
  const heading = document.createElement('h2'); heading.textContent = conversationId
  const state = document.createElement('p'); state.textContent = 'Connecting'
  const history = document.createElement('pre')
  const form = document.createElement('form')
  const text = document.createElement('input'); text.setAttribute('aria-label', 'Message')
  const send = document.createElement('button'); send.textContent = 'Send'; send.disabled = true
  const file = document.createElement('input'); file.type = 'file'; file.setAttribute('aria-label', 'Attachment'); file.disabled = true
  const close = document.createElement('button'); close.textContent = 'Close view'
  form.append(text, send); panel.append(heading, state, history, form, file, close)
  document.querySelector('#views').append(panel)
  let attachments = []
  let dead = false
  const request = async (path, signal) => {
    const response = await fetch(new URL(path, base), { credentials, headers: await session.headers(signal), signal })
    if (!response.ok) throw Error('Chat request failed: ' + response.status)
    return response.json()
  }
  const client = createChatClient({ baseUrl, credentials, session,
    resynchronize: async (_snapshot, signal) => {
      const messages = await request('/api/conversations/' + encodeURIComponent(conversationId), signal)
      if (!dead) history.textContent = JSON.stringify(messages, null, 2)
    } })
  client.transport.subscribe(event => {
    if (dead) return
    if (event.type === 'ready') {
      state.textContent = 'Ready'
      send.disabled = !event.snapshot.context.capabilities.some(c => c.id === 'chat.text' && c.available)
      file.disabled = !event.snapshot.context.capabilities.some(c => c.id === 'chat.attachments' && c.available)
    } else if (event.type === 'state') { state.textContent = event.state; send.disabled = file.disabled = true }
    else if (event.type === 'error') state.textContent = event.error.message
    else if (event.type === 'message') history.textContent += '\n' + JSON.stringify(event.message)
  })
  form.onsubmit = async event => {
    event.preventDefault()
    try {
      const content = text.value
      let messageId
      if (!delegatedAccessToken) {
        const signal = new AbortController().signal
        const headers = new Headers(await session.headers(signal)); headers.set('content-type', 'application/json')
        const saved = await fetch(new URL('/api/conversations/' + encodeURIComponent(conversationId) + '/messages', base),
          { method: 'POST', credentials, headers, body: JSON.stringify({ role: 'u0', text: content, time: new Date().toISOString() }) })
        if (!saved.ok) throw Error('Message could not be saved')
        messageId = (await saved.json()).id
      }
      if (dead) return
      client.transport.send({ t: 'claude.send', conversationId, messageId, segments: [{ speakerId: 1, text: content }], attachments })
      text.value = ''; attachments = []
    }
    catch (error) { state.textContent = error.message }
  }
  file.onchange = async () => {
    const selected = file.files?.[0]
    if (!selected || selected.size > 32 * 1024 * 1024) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const upload = await client.attachments.upload({ conversationId, name: selected.name, mimeType: selected.type,
          dataBase64: String(reader.result).split(',')[1] })
        if (!dead) { attachments.push(upload.id); state.textContent = 'Attachment ready' }
      } catch (error) { if (!dead) state.textContent = error.message }
    }
    reader.readAsDataURL(selected)
  }
  const dispose = () => { if (dead) return; dead = true; client.dispose(); panel.remove(); views.delete(dispose) }
  close.onclick = dispose; views.add(dispose)
  client.transport.connect()
  return { client, dispose }
}
document.querySelector('#login').onsubmit = async event => {
  event.preventDefault()
  const form = event.currentTarget
  try {
    const password = form.elements.password.value
    form.elements.password.value = ''
    const response = await fetch(new URL('/api/session/login', coreInput.value), { method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: form.elements.user.value, password }) })
    status.textContent = response.ok ? 'Signed in. Enter an existing conversation ID.' : 'Sign in failed'
  } catch { status.textContent = 'Core could not be reached' }
}
document.querySelector('#connect').onsubmit = event => {
  event.preventDefault()
  try { connectExternalChat(coreInput.value, event.currentTarget.elements.conversation.value) }
  catch (error) { status.textContent = error.message }
}
window.addEventListener('pagehide', () => { for (const dispose of views) dispose() }, { once: true })
