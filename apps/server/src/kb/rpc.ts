import type { KbUsageRequest, KbUsageResult } from '@voicechat/shared'
import { createInProcessKbRpc, KbRpcError, type KbRpcPorts } from '../../../../packages/knowledge/src/rpc.js'
import type { VoiceChatDb } from '../db/database.js'
import type { KnowledgeBaseService } from './types.js'
import { kbViewOf, kbWriteDenial } from './access.js'
import { kbUsageFlags } from './routes.js'

/** Live identity lookup prevents stale role or membership snapshots granting writes. */
export function createLocalKbRpc(kb: KnowledgeBaseService, db: VoiceChatDb, toolEnabled: boolean) {
  const userOf = async (userId: string) => {
    const user = await db.identity.getUser(userId)
    if (!user || user.blocked) throw new KbRpcError(403, 'authentication required')
    return user
  }
  const required = <T>(report: T | null): T => {
    if (!report) throw new KbRpcError(404, 'KB usage target not found')
    return report
  }
  const ports: KbRpcPorts<string> = {
    access: {
      view: async userId => { await userOf(userId); return kbViewOf(db, userId) },
      writeDenial: async (userId, target) => kbWriteDenial(db, await userOf(userId), target)
    },
    documents: {
      get: id => db.kb.kbDocumentById(id),
      save: (draft, userId) => db.kb.saveKbDocument({ ...draft,
        ownerId: draft.scope === 'user' ? userId : null,
        projectId: draft.scope === 'project' ? draft.projectId ?? null : null,
        createdBy: userId }),
      delete: async id => { await db.kb.deleteKbDocument(id) }
    },
    usage: async (arg: KbUsageRequest, userId: string): Promise<KbUsageResult> => {
      await userOf(userId)
      switch (arg.target) {
        case 'conversation': return { target: arg.target, report: {
          ...required(await db.kb.kbUsageReport(userId, arg.conversationId)), ...await kbUsageFlags(kb, toolEnabled) } }
        case 'project': return { target: arg.target, report: {
          ...required(await db.kb.kbUsageProjectReport(userId, arg.projectId)), ...await kbUsageFlags(kb, toolEnabled) } }
        case 'run': return { target: arg.target, report: required(await db.kb.kbUsageRunReport(userId, arg.runId)) }
        case 'task': return { target: arg.target, report: required(await db.kb.kbUsageTaskReport(userId, arg.projectId, arg.taskId)) }
      }
    }
  }
  return createInProcessKbRpc(kb, ports)
}
