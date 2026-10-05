import { FileKnowledgeBaseService as Engine, loadFileDocuments as load } from '../../../../packages/knowledge/src/service.js'
import type { KbSemanticReranker } from './types.js'
import { kbFiles } from './files.js'
export const loadFileDocuments = (root: string, module = 'core', sourceRoot = 'docs/kb') => load(root, module, sourceRoot, kbFiles)
export class FileKnowledgeBaseService extends Engine {
  constructor(root: string, reranker?: KbSemanticReranker) { super(root, reranker, kbFiles) }
}
