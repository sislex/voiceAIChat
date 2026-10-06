import { repositoryKey, type KbSource, type ModuleState } from '../../../../packages/knowledge/src/sources.js'

export const isCoreRepository = (repository: string): boolean =>
  repositoryKey(repository).toLowerCase() === 'github.com/sislex/voiceaichat'

/** Accept only the ownership table's documented grammar, never arbitrary Markdown links. */
export function parseOwnerModules(markdown: string): KbSource[] {
  const lines = markdown.split(/\r?\n/)
  const cells = (line: string) => line.trim().slice(1, -1).split('|').map(cell => cell.trim())
  const headers = lines.flatMap((line, i) => line.trim() === '| Module | Repository | Knowledge base | Owner responsibility |' ? [i] : [])
  const invalid = () => { throw new Error('Invalid KB owner module map') }
  if (headers.length !== 1) return invalid()
  const start = headers[0]!
  if (!/^\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|$/.test(lines[start + 1] ?? '')) return invalid()
  const ids = new Set<string>(), repositories = new Set<string>()
  const sources: KbSource[] = []
  for (let i = start + 2; i < lines.length && lines[i]!.trim().startsWith('|'); i++) {
    const line = lines[i]!.trim(), row = cells(line)
    if (!line.endsWith('|') || row.length !== 4) return invalid()
    const [module, repository, knowledge, responsibility] = row
    const id = /^`([a-z][a-z0-9]*(?:-[a-z0-9]+)*)`$/.exec(module!)?.[1]
    if (!id || ids.has(id) || !responsibility) return invalid()
    ids.add(id)
    if (/^нет(?: \([^()]+\))?$/.test(knowledge!)) continue
    const repo = /^`([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+)`$/.exec(repository!)?.[1]
    if (!repo || knowledge !== `\`${id}:README.md\` (\`docs/kb\`)` || repositories.has(repo.toLowerCase())) return invalid()
    repositories.add(repo.toLowerCase())
    sources.push({ id, title: id, repository: `https://github.com/${repo}.git`, ref: 'main', path: 'docs/kb' })
  }
  if (!sources.some(source => source.id === 'core' && isCoreRepository(source.repository!))) return invalid()
  return sources
}

interface OwnerModuleRegistry {
  modules(): Promise<ModuleState[]>
  ensureSource(input: { id?: string; repository: string; ref?: string; path?: string; title?: string }): Promise<ModuleState>
  removeSource(id: string): Promise<boolean>
}

export async function reconcileOwnerModules(registry: OwnerModuleRegistry, markdown: string): Promise<ModuleState[]> {
  // Validate the entire map before mutating registrations.
  const sources = parseOwnerModules(markdown)
  for (const module of await registry.modules()) {
    if (module.id !== 'core' && module.repository && isCoreRepository(module.repository)) await registry.removeSource(module.id)
  }
  for (const source of sources) await registry.ensureSource({ ...source, repository: source.repository! })
  return registry.modules()
}
