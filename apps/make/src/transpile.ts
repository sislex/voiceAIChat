// Transpile Make project JSX/TSX/TS when serving previews. Projects have no build step: index.html
// imports React from esm.sh, but browsers cannot parse JSX. Use esbuild to produce ESM and cache by
// conversation, path, and revision so a file is compiled only once per revision.

import { transform } from 'esbuild'
import { isMakeTranspiledPath } from '@voicechat/shared'

const cache = new Map<string, { rev: number; code: string }>()
const CACHE_LIMIT = 500

/** Check project file existence when resolving an extensionless import such as ./App. */
export type FileExists = (path: string) => boolean

const RESOLVE_EXTENSIONS = ['.jsx', '.tsx', '.ts', '.js', '/index.jsx', '/index.tsx', '/index.js']

/** Resolve extensionless relative imports to existing files because browsers do not infer extensions. */
export function rewriteRelativeImports(code: string, fromPath: string, exists: FileExists): string {
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
  const resolve = (spec: string): string => {
    if (/\.[a-z0-9]+$/i.test(spec)) return spec
    const joined = normalizeJoin(dir, spec)
    for (const ext of RESOLVE_EXTENSIONS) if (exists(joined + ext)) return spec + ext
    return spec
  }
  return code.replace(/((?:from|import)\s*\(?\s*)(['"])(\.\.?\/[^'"\n]+)\2/g, (_m, lead: string, q: string, spec: string) => `${lead}${q}${resolve(spec)}${q}`)
}

function normalizeJoin(dir: string, spec: string): string {
  const parts = dir ? dir.split('/') : []
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/** Compilation issues for make_check and editor markers; an empty array means the file compiles. */
export async function compileDiagnostics(path: string, source: string): Promise<Array<{ line: number; column: number; message: string }>> {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  try {
    await transform(source, { loader: ext === 'tsx' ? 'tsx' : ext === 'ts' ? 'ts' : 'jsx', format: 'esm', target: 'es2020', jsx: 'automatic', tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }, sourcefile: path, logLevel: 'silent' })
    return []
  } catch (error) {
    const errors = (error as { errors?: Array<{ text: string; location?: { line: number; column: number } | null }> }).errors
    if (!errors?.length) return [{ line: 1, column: 1, message: error instanceof Error ? error.message : String(error) }]
    return errors.map((e) => ({ line: e.location?.line ?? 1, column: (e.location?.column ?? 0) + 1, message: e.text }))
  }
}

export async function transpileForPreview(conversationId: string, path: string, source: string, rev: number, exists: FileExists): Promise<string> {
  const key = `${conversationId}:${path}`
  const hit = cache.get(key)
  if (hit && hit.rev === rev) return hit.code
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  let code: string
  try {
    const result = await transform(source, {
      loader: ext === 'tsx' ? 'tsx' : ext === 'ts' ? 'ts' : 'jsx',
      format: 'esm',
      target: 'es2020',
      jsx: 'automatic',
      tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
      sourcefile: path
    })
    code = rewriteRelativeImports(result.code, path, exists)
  } catch (error) {
    // Report readable compilation errors in the preview console instead of returning 500, keeping
    // the page alive.
    const message = error instanceof Error ? error.message : String(error)
    code = `throw new Error(${JSON.stringify(`Ошибка компиляции ${path}: ${message}`)})\n`
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, { rev, code })
  return code
}

export { isMakeTranspiledPath }
