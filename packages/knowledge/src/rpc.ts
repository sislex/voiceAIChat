import {
  createKbServiceRpcDispatcher,
  type KbDocumentDraft, type KbScope, type KbTopicsRequest,
  type KbServiceRpcHandlers, type KbUsageRequest, type KbUsageResult
} from '@voicechat/shared'
import type { KnowledgeBaseService, KbView } from './types.js'
import type { KbStoredDocument } from './ports.js'

export class KbRpcError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message) }
}

/** Viewer identity is supplied by the authenticated host, never decoded from arg. */
export interface KbAccess<Viewer> {
  view(viewer: Viewer): Promise<KbView>
  writeDenial(viewer: Viewer, target: { scope: KbScope; projectId?: string | null }): Promise<string | null>
}
export interface KbDocumentStore {
  get(id: string): Promise<KbStoredDocument | null>
  save(draft: KbDocumentDraft, userId: string): Promise<KbStoredDocument>
  delete(id: string): Promise<void>
}
export interface KbRpcPorts<Viewer> {
  access: KbAccess<Viewer>
  documents: KbDocumentStore
  usage(request: KbUsageRequest, viewer: Viewer): Promise<KbUsageResult>
}

/** Same validated registry for the embedded service and a future RPC transport. */
export function createInProcessKbRpc<Viewer>(kb: KnowledgeBaseService, ports: KbRpcPorts<Viewer>) {
  const viewOf = async (viewer: Viewer, filter?: KbTopicsRequest | void): Promise<KbView> => {
    const view = await ports.access.view(viewer)
    if (filter?.projectId && !view.projectIds.includes(filter.projectId)) {
      throw new KbRpcError(403, 'нет доступа к знаниям этого проекта')
    }
    // Copy only filters: forward-compatible payload fields cannot impersonate a viewer.
    return { ...view, ...(filter?.scope ? { scope: filter.scope } : {}),
      ...(filter?.projectId ? { projectId: filter.projectId } : {}),
      ...(filter?.module ? { module: filter.module } : {}) }
  }
  const authorize = async (viewer: Viewer, target: { scope: KbScope; projectId?: string | null }, owner?: string | null) => {
    const view = await ports.access.view(viewer)
    if (!view.userId) throw new KbRpcError(403, 'authentication required')
    const denial = await ports.access.writeDenial(viewer, target)
    if (denial || (target.scope === 'user' && owner !== undefined && owner !== view.userId)) {
      throw new KbRpcError(403, denial ?? 'чужая статья')
    }
    return view.userId
  }
  const existing = async (id: string) => {
    const row = await ports.documents.get(id)
    if (!row) throw new KbRpcError(404, 'KB document not found')
    return row
  }
  const handlers: KbServiceRpcHandlers<Viewer> = {
    status: () => kb.status(),
    modules: async () => kb.modules?.() ?? [],
    topics: async (arg, viewer) => kb.topics(await viewOf(viewer, arg)),
    document: async (arg, viewer) => kb.document(arg.id, await viewOf(viewer)),
    search: async (arg, viewer) => kb.search(arg, await viewOf(viewer, arg)),
    context: async (arg, viewer) => kb.context(arg.query, arg.budget, await viewOf(viewer, arg)),
    write: async (arg, viewer) => {
      const title = arg.title.trim()
      if (!title) throw new KbRpcError(400, 'title required')
      const userId = await authorize(viewer, arg)
      if (arg.id) {
        const row = await existing(arg.id)
        await authorize(viewer, row, row.ownerId)
      }
      const saved = await ports.documents.save({ ...arg, title }, userId)
      const document = await kb.document(saved.id, await viewOf(viewer))
      if (!document) throw new KbRpcError(404, 'KB document not found')
      return document
    },
    delete: async (arg, viewer) => {
      const row = await existing(arg.id)
      await authorize(viewer, row, row.ownerId)
      await ports.documents.delete(arg.id)
    },
    usage: (arg, viewer) => ports.usage(arg, viewer)
  }
  return createKbServiceRpcDispatcher(handlers)
}
