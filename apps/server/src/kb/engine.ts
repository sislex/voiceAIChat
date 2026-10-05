export * from '../../../../packages/knowledge/src/engine.js'
export { listMarkdown } from './files.js'
import { loadDocument as load } from '../../../../packages/knowledge/src/engine.js'
import { kbFiles } from './files.js'
export const loadDocument = (root: string, path: string, module = 'core', sourceRoot = 'docs/kb') => load(root, path, module, sourceRoot, kbFiles)
