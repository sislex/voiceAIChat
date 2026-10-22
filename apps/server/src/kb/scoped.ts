import { ScopedKnowledgeBase as Engine } from '../../../../packages/knowledge/src/scoped.js'
import type { KbScopedStore } from '../../../../packages/knowledge/src/ports.js'
import type { VoiceChatDb } from '../db/database.js'
import type { KnowledgeBaseService, KbSemanticReranker } from './types.js'
export { canSee, indexStored } from '../../../../packages/knowledge/src/scoped.js'
export function createKbScopedStore(db: VoiceChatDb): KbScopedStore {
  return {
    version: () => db.kb.kbDocumentsVersion(),
    documents: () => db.kb.kbDocuments(),
    projectRepository: async (userId, projectId) => (await db.projects.getProject(userId, projectId))?.gitUrl
  }
}
export class ScopedKnowledgeBase extends Engine {
  constructor(base: KnowledgeBaseService, db: VoiceChatDb, reranker?: KbSemanticReranker) {
    super(base, createKbScopedStore(db), reranker)
  }
}
