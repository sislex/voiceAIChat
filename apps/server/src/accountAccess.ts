import type { FastifyInstance } from 'fastify'
import { hasProductCapability, type ClientMessage, type Conversation, type ProductCapability, type ServerMessage, type SessionUser } from '@voicechat/shared'
import { conversationCapability } from '@sislexa/identity/server/users/productPolicy'
import type { VoiceChatDb } from './db/database.js'

export const TARIFF_DENIED = 'Этот модуль недоступен в вашем тарифе. Обратитесь к администратору.'
export function capabilityForConversation(conversation: Pick<Conversation, 'assistantKind' | 'scope'>): ProductCapability {
  return conversation.assistantKind ? conversationCapability(conversation.assistantKind) : conversation.scope === 'kanban' ? 'projects.use' : 'chat.use'
}
export async function userHasCapability(db: VoiceChatDb, name: string, capability: ProductCapability): Promise<boolean> {
  const user = await db.identity.getUser(name)
  if (!user || user.blocked) return false
  return (await db.identity.getAccountAccess(name))?.capabilities.includes(capability) === true
}

/** Product policy complements Identity's route checks with Core-owned resource context. */
export function registerAccountAccess(app: FastifyInstance, db: VoiceChatDb): void {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.user || ['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(req.method)) return
    const url = req.url.split('?')[0]!
    let capability: ProductCapability | null = null
    let projectCapability = false
    if (url === '/api/conversations') {
      const body = req.body as Partial<Conversation> | undefined
      capability = capabilityForConversation({ assistantKind: body?.assistantKind, scope: body?.scope ?? 'chat' })
      projectCapability = body?.scope === 'kanban'
    } else if (url === '/api/conversations/draft' || /^\/api\/(cc|cx)\/.*resume/.test(url)) capability = 'chat.use'
    else {
      const match = /^\/api\/conversations\/([^/]+)(?:\/|$)/.exec(url)
      if (match) {
        const conversation = await db.chat.getConversation(req.user.name, decodeURIComponent(match[1]!))
        if (conversation) { capability = capabilityForConversation(conversation); projectCapability = conversation.scope === 'kanban' }
      }
    }
    if (projectCapability && !hasProductCapability(req.user.account, 'projects.use')) capability = 'projects.use'
    if (capability && !hasProductCapability(req.user.account, capability)) return reply.code(403).send({ error: 'capability_unavailable', capability, message: TARIFF_DENIED })
  })
}

/** Cancellation stays available; new execution always uses the stored conversation kind. */
export async function commandAccessError(db: VoiceChatDb, user: SessionUser, msg: ClientMessage): Promise<ServerMessage | null> {
  let capability: ProductCapability | null = null
  if (msg.t === 'audio.start' || msg.t === 'stt.download') capability = 'voice.stt'
  else if (msg.t === 'tts.speak' || msg.t === 'tts.downloadVoice') capability = 'voice.tts'
  else if (['pty.start', 'pty.input', 'pty.resize', 'cc.tail.start', 'cx.tail.start'].includes(msg.t)) capability = 'machines.use'
  else if (msg.t === 'board.subscribe' || msg.t === 'ci.subscribe') capability = 'projects.use'
  else if (msg.t.startsWith('claude.') && 'conversationId' in msg && typeof msg.conversationId === 'string') {
    const conversation = await db.chat.getConversation(user.name, msg.conversationId)
    if (!conversation) return { t: 'claude.error', conversationId: msg.conversationId, message: 'Разговор недоступен.' }
    if (msg.t === 'claude.send' || msg.t === 'claude.queue.now' || msg.t === 'claude.queue.edit') {
      capability = conversation.scope === 'kanban' && !hasProductCapability(user.account, 'projects.use') ? 'projects.use' : capabilityForConversation(conversation)
    }
  }
  if (!capability || hasProductCapability(user.account, capability)) return null
  if (capability === 'voice.stt') return { t: 'stt.error', message: TARIFF_DENIED }
  if (capability === 'voice.tts') return { t: 'tts.error', message: TARIFF_DENIED }
  if ('ptyId' in msg) return { t: 'pty.error', ptyId: msg.ptyId, message: TARIFF_DENIED }
  return { t: 'claude.error', conversationId: 'conversationId' in msg ? msg.conversationId ?? '' : '', message: TARIFF_DENIED }
}
