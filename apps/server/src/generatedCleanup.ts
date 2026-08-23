import { randomUUID } from 'node:crypto'
import { parseImages, type Message } from '@voicechat/shared'
import type { ResolvedManagedChatStorage } from './uploads.js'

export interface GeneratedCleanupCounters { runId: string; checked: number; deleted: number; skipped: number; deferred: number }
export interface GeneratedCleanupTarget { userId: string; conversationId: string }
export interface GeneratedCleanupDeps {
  targets(): GeneratedCleanupTarget[]
  ttlDays(userId: string): number
  messages(userId: string, conversationId: string): Message[]
  resolve(userId: string, conversationId: string): Promise<ResolvedManagedChatStorage | null>
  list(machineId: string, path: string): Promise<{ entries?: Array<{ name: string; kind: 'file' | 'dir' | 'symlink' | 'other'; mtime: number }> }>
  deleteFile(machineId: string, path: string): Promise<unknown>
  defer(target: GeneratedCleanupTarget, error: string, nextAttemptAt: number): void
  complete(target: GeneratedCleanupTarget): void
  log(result: GeneratedCleanupCounters): void
  now?: () => number
}

const active = new Set<string>()
const leaseKey = (machineId: string, path: string): string => `${machineId}\0${path}`

/** Защищает файл от очистки на всё опасное окно ретуши/публикации. */
export async function withGeneratedFileLease<T>(machineId: string, path: string, action: () => Promise<T>): Promise<T> {
  const key = leaseKey(machineId, path)
  active.add(key)
  try { return await action() } finally { active.delete(key) }
}

function directFilePath(root: string, name: string): string | null {
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) return null
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[/\\]+$/, '')}${separator}${name}`
}

function references(messages: Message[], machineId: string): Set<string> {
  const paths = new Set<string>()
  for (const message of messages) {
    for (const file of message.attachments ?? []) if (file.agentId === machineId) paths.add(file.path)
    for (const image of parseImages(message.text).images) if (image.agentId === machineId) paths.add(image.path)
  }
  return paths
}

export class GeneratedCleanupService {
  constructor(private readonly deps: GeneratedCleanupDeps) {}

  async run(): Promise<GeneratedCleanupCounters> {
    const result: GeneratedCleanupCounters = { runId: randomUUID(), checked: 0, deleted: 0, skipped: 0, deferred: 0 }
    const now = this.deps.now?.() ?? Date.now()
    for (const target of this.deps.targets()) {
      try {
        let targetDeferred = false
        const storage = await this.deps.resolve(target.userId, target.conversationId)
        if (!storage) {
          this.deps.defer(target, 'managed_binding_missing', now + 3_600_000)
          result.deferred++
          continue
        }
        const cutoff = now - this.deps.ttlDays(target.userId) * 86_400_000
        const listing = await this.deps.list(storage.binding.machineId, storage.generated)
        const live = references(this.deps.messages(target.userId, target.conversationId), storage.binding.machineId)
        for (const entry of listing.entries ?? []) {
          result.checked++
          const path = directFilePath(storage.generated, entry.name)
          if (!path || entry.kind !== 'file' || entry.mtime >= cutoff || live.has(path) || active.has(leaseKey(storage.binding.machineId, path))) {
            result.skipped++
            continue
          }
          const fresh = references(this.deps.messages(target.userId, target.conversationId), storage.binding.machineId)
          if (fresh.has(path) || active.has(leaseKey(storage.binding.machineId, path))) {
            result.skipped++
            continue
          }
          try {
            await this.deps.deleteFile(storage.binding.machineId, path)
            result.deleted++
          } catch (error) {
            if (error instanceof Error && /ENOENT|not found|не найден/i.test(error.message)) { result.deleted++; continue }
            this.deps.defer(target, error instanceof Error ? error.message : String(error), now + 3_600_000)
            targetDeferred = true
            result.deferred++
          }
        }
        if (!targetDeferred) this.deps.complete(target)
      } catch (error) {
        this.deps.defer(target, error instanceof Error ? error.message : String(error), now + 3_600_000)
        result.deferred++
      }
    }
    this.deps.log(result)
    return result
  }
}
