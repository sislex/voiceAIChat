// Attachments of abandoned drafts. An attachment is uploaded before its message is sent; when the
// tab is closed or the draft is cleared without the client telling Core, the stored file would stay
// in the chat space and in the quota forever. The upload registry keeps a durable record of every
// conversation upload, so the sweep can tell such a file from one the user put there through the
// Files panel: only files with an upload record are ever touched.
//
// Whether an upload is bound is not stored as a flag. It is derived from the messages of the
// conversation at sweep time, which stays correct across queued turns, edits, retries and branches.

import type { MessageAttachment } from '@voicechat/shared'
import { attachmentUsesUpload, type StoredUpload, type UploadStore } from './uploads.js'

export const DEFAULT_DRAFT_UPLOAD_MAX_AGE_MS = 24 * 60 * 60_000
export const DRAFT_UPLOAD_SWEEP_INTERVAL_MS = 60 * 60_000

export interface DraftUploadDeps {
  uploads: Pick<UploadStore, 'list' | 'remove' | 'forget'>
  conversationExists(userId: string, conversationId: string): Promise<boolean>
  conversationAttachments(userId: string, conversationId: string): Promise<MessageAttachment[]>
  /** Deletes the stored file of a storage-backed upload; a missing file is not an error. */
  deleteStorageFile?(userId: string, spaceId: string, path: string): Promise<void>
  now?: () => number
  log?: (message: string) => void
}

export interface DraftUploadReportItem {
  id: string
  name: string
  conversationId: string
  size: number
  ageMs: number
  backend: 'storage' | 'machine' | 'server'
}

export interface DraftUploadReport {
  applied: boolean
  maxAgeMs: number
  /** Unbound uploads older than the threshold. */
  drafts: DraftUploadReportItem[]
  removed: number
  freedBytes: number
  failed: number
}

function backendOf(upload: StoredUpload): DraftUploadReportItem['backend'] {
  return upload.storage ? 'storage' : upload.agentId ? 'machine' : 'server'
}

/**
 * Finds uploads of abandoned drafts and, with `apply`, removes them.
 *
 * - bound to a message: the record is dropped, the file stays with the message;
 * - conversation is gone: the record is dropped (its chat space went with the conversation);
 * - unbound and older than `maxAgeMs`: reported; with `apply` a storage-backed file is deleted
 *   together with its record. Files on a machine or on the server keep the previous behaviour and
 *   are only reported.
 */
export async function sweepDraftUploads(deps: DraftUploadDeps, options: { maxAgeMs?: number; apply?: boolean; userId?: string } = {}): Promise<DraftUploadReport> {
  const now = (deps.now ?? Date.now)()
  const maxAgeMs = Math.max(0, options.maxAgeMs ?? DEFAULT_DRAFT_UPLOAD_MAX_AGE_MS)
  const apply = options.apply === true
  const report: DraftUploadReport = { applied: apply, maxAgeMs, drafts: [], removed: 0, freedBytes: 0, failed: 0 }
  const attachments = new Map<string, MessageAttachment[] | null>()
  for (const upload of deps.uploads.list()) {
    if (!upload.ownerId || !upload.conversationId) continue
    if (options.userId && upload.ownerId !== options.userId) continue
    const ageMs = now - (upload.createdAt ?? now)
    if (ageMs < maxAgeMs) continue
    const key = `${upload.ownerId}\u0000${upload.conversationId}`
    try {
      if (!attachments.has(key)) {
        attachments.set(key, await deps.conversationExists(upload.ownerId, upload.conversationId)
          ? await deps.conversationAttachments(upload.ownerId, upload.conversationId)
          : null)
      }
      const used = attachments.get(key)
      if (used === null || used === undefined) { if (apply) deps.uploads.forget(upload.id); continue }
      if (used.some(attachment => attachmentUsesUpload(attachment, upload))) { if (apply) deps.uploads.forget(upload.id); continue }
      report.drafts.push({ id: upload.id, name: upload.name, conversationId: upload.conversationId, size: upload.size, ageMs, backend: backendOf(upload) })
      if (!apply || !upload.storage || !deps.deleteStorageFile) continue
      await deps.deleteStorageFile(upload.ownerId, upload.storage.spaceId, upload.storage.path)
      deps.uploads.remove(upload.id)
      report.removed++
      report.freedBytes += upload.size
    } catch (error) {
      // Storage may be down; the upload stays for the next sweep and Core keeps running.
      report.failed++
      deps.log?.(`[draft-uploads] ${upload.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return report
}

/** Runs the sweep at start and then periodically. Returns the stop function. */
export function startDraftUploadSweep(deps: DraftUploadDeps, maxAgeMs: number, intervalMs = DRAFT_UPLOAD_SWEEP_INTERVAL_MS): () => void {
  const run = (): void => {
    void sweepDraftUploads(deps, { maxAgeMs, apply: true })
      .then(report => { if (report.removed || report.failed) deps.log?.(`[draft-uploads] removed ${report.removed}, freed ${report.freedBytes} bytes, failed ${report.failed}`) })
      .catch(error => deps.log?.(`[draft-uploads] sweep failed: ${error instanceof Error ? error.message : String(error)}`))
  }
  const first = setTimeout(run, 30_000)
  const timer = setInterval(run, intervalMs)
  first.unref?.()
  timer.unref?.()
  return () => { clearTimeout(first); clearInterval(timer) }
}
