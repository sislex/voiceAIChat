import { stripServiceData, type Message, type ServerMessage } from '@voicechat/shared'
import type { VoiceChatDb } from './db/database.js'

export async function loadsServiceData(db: VoiceChatDb, userId: string, conversationId: string): Promise<boolean> {
  return (await db.settings.getChatSettings(userId, conversationId))?.conversation.loadServiceData === true
}

export function clientMessage(message: Message, _enabled: boolean): Message {
  return !message.meta ? message : { ...message, meta: stripServiceData(message.meta) }
}

/** Completed diagnostics are available only from the single-message endpoint. */
export async function clientMessages(db: VoiceChatDb, userId: string, conversationId: string, messages?: Message[]): Promise<Message[]> {
  return (messages ?? await db.chat.listMessages(userId, conversationId)).map(message => clientMessage(message, false))
}

export async function clientEvent(_db: VoiceChatDb, _userId: string, event: ServerMessage): Promise<ServerMessage> {
  if (event.t !== 'claude.done' && event.t !== 'chat.message') return event
  if (event.t === 'chat.message') return { ...event, message: clientMessage(event.message, false) }
  return { ...event,
    ...(event.meta ? { meta: stripServiceData(event.meta) } : {}),
    ...(event.message ? { message: clientMessage(event.message, false) } : {})
  }
}
