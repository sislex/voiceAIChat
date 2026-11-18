import type { StorageSpace } from '@voicechat/shared/fileStorage'
import type { FileStorageService } from '../../../../packages/file-storage/src/service.js'

const FALLBACK_TITLE = 'Chat files'

/** The space of a conversation carries the conversation title, so the storage UI can tell them apart. */
export function chatSpaceTitle(conversationTitle: string | null | undefined): string {
  return conversationTitle?.trim().slice(0, 200) || FALLBACK_TITLE
}

/** Chat spaces the user owns for one conversation (normally one). */
export async function ownedChatSpaces(storage: FileStorageService, userId: string, conversationId: string): Promise<StorageSpace[]> {
  return (await storage.listSpaces(userId)).filter(space => space.kind === 'chat' && space.ref === conversationId && space.ownerId === userId)
}

/** Opens the space of a conversation and keeps its title equal to the conversation title. */
export async function openChatSpace(storage: FileStorageService, userId: string, conversationId: string, conversationTitle: string | null | undefined): Promise<StorageSpace> {
  const title = chatSpaceTitle(conversationTitle)
  const space = await storage.createSpace(userId, { kind: 'chat', title, ref: conversationId })
  if (space.title === title || space.ownerId !== userId) return space
  // A rename must never fail the upload itself.
  return storage.updateSpace(userId, space.id, { title }).catch(() => space)
}

export async function renameChatSpaces(storage: FileStorageService, userId: string, conversationId: string, conversationTitle: string): Promise<void> {
  const title = chatSpaceTitle(conversationTitle)
  for (const space of await ownedChatSpaces(storage, userId, conversationId))
    if (space.title !== title) await storage.updateSpace(userId, space.id, { title })
}

/** Removes the files of a deleted conversation; they would otherwise stay in the owner's quota. */
export async function deleteChatSpaces(storage: FileStorageService, userId: string, conversationId: string): Promise<number> {
  const spaces = await ownedChatSpaces(storage, userId, conversationId)
  for (const space of spaces) await storage.deleteSpace(userId, space.id)
  return spaces.length
}

/**
 * Chat spaces whose conversation no longer exists: left behind by deletions made before spaces
 * were removed with their conversation, or by a storage outage during a deletion.
 */
export async function orphanChatSpaces(storage: FileStorageService, userId: string, conversationExists: (conversationId: string) => Promise<boolean>): Promise<StorageSpace[]> {
  const orphans: StorageSpace[] = []
  for (const space of await storage.listSpaces(userId)) {
    if (space.kind !== 'chat' || space.ownerId !== userId || !space.ref) continue
    if (!await conversationExists(space.ref)) orphans.push(space)
  }
  return orphans
}

const reserved = new Map<string, number>()
const RESERVE_MS = 10 * 60_000

function withSuffix(name: string, index: number): string {
  if (index === 1) return name
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} (${index})${name.slice(dot)}` : `${name} (${index})`
}

/**
 * Path of a new chat attachment: `YYYY-MM-DD/<name>`, with ` (2)`, ` (3)`… when the name is taken
 * that day. Paths handed out recently are reserved in memory, because several attachments of one
 * message are uploaded in parallel and their bodies are streams that cannot be retried.
 */
export async function chatUploadPath(storage: FileStorageService, userId: string, spaceId: string, name: string, now = Date.now()): Promise<string> {
  const folder = new Date(now).toISOString().slice(0, 10)
  const safe = name.replace(/[/\\]/g, '_').replace(/^\.+$/, '_') || 'file'
  const taken = new Set((await storage.listEntries(userId, spaceId, folder + '/')).entries.map(entry => entry.path))
  for (const [key, until] of reserved) if (until < now) reserved.delete(key)
  for (let index = 1; ; index++) {
    const path = `${folder}/${withSuffix(safe, index)}`
    const key = `${spaceId}\u0000${path}`
    if (taken.has(path) || reserved.has(key)) continue
    reserved.set(key, now + RESERVE_MS)
    return path
  }
}
