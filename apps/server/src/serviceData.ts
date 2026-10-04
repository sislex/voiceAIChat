import { stripServiceData, type Message, type ServerMessage } from '@voicechat/shared'
import type { VoiceChatDb } from './db/database.js'

export async function loadsServiceData(db: VoiceChatDb, userId: string, conversationId: string): Promise<boolean> {
  return (await db.settings.getChatSettings(userId, conversationId))?.conversation.loadServiceData === true
}

export function clientMessage(message: Message, enabled: boolean): Message {
  return enabled || !message.meta ? message : { ...message, meta: stripServiceData(message.meta) }
}

/** Project only at transport boundaries; database and prompt readers retain full metadata. */
export async function clientMessages(db: VoiceChatDb, userId: string, conversationId: string, messages?: Message[]): Promise<Message[]> {
  const enabled = await loadsServiceData(db, userId, conversationId)
  return (messages ?? await db.chat.listMessages(userId, conversationId)).map(message => clientMessage(message, enabled))
}

export async function clientEvent(db: VoiceChatDb, userId: string, event: ServerMessage): Promise<ServerMessage> {
  if (event.t !== 'claude.done' && event.t !== 'chat.message') return event
  const enabled = await loadsServiceData(db, userId, event.conversationId)
  if (event.t === 'chat.message') return { ...event, message: clientMessage(event.message, enabled) }
  return { ...event,
    ...(event.meta ? { meta: enabled ? event.meta : stripServiceData(event.meta) } : {}),
    ...(event.message ? { message: clientMessage(event.message, enabled) } : {})
  }
}
