import type { KbFiles, KbGit } from './ports.js'
import { isAbsolute, join } from 'node:path'
import { isKbModuleId, type KbModule } from '@voicechat/shared'
import { FileKnowledgeBaseService, loadFileDocuments } from './service.js'
import type { IndexedDocument } from './engine.js'
import type { KbSemanticReranker } from './types.js'

export type KbSource = Pick<KbModule, 'id' | 'title' | 'repository' | 'ref' | 'path'>
export type ModuleState = KbModule & { error?: string }

/** Operator-controlled configuration; no credentials are accepted in URLs. */
export function readKbSources(dataDir: string, files: KbFiles, override?: string): KbSource[] {
  const file = join(dataDir, 'kb-modules.json')
  let input: unknown
  try { input = JSON.parse(override ?? (files.exists(file) ? files.read(file) : '[]')) }
  catch { throw new Error('Invalid KB module configuration') }
  if (!Array.isArray(input)) throw new Error('Invalid KB module configuration')
  const ids = new Set(['core'])
  return input.map((value: unknown) => {
    const source = value as KbSource
    if (!source || !isKbModuleId(source.id) || ids.has(source.id)
      || typeof source.title !== 'string' || !source.title.trim()
      || typeof source.repository !== 'string' || !source.repository
      || typeof source.ref !== 'string' || !source.ref || source.ref.startsWith('-') || /[\s\x00-\x1f]/.test(source.ref)
      || typeof source.path !== 'string' || !source.path || isAbsolute(source.path)
      || source.path.split('/').some(part => !part || part === '.' || part === '..') || /[\\\x00-\x1f*?\[\]]/.test(source.path)) {
      throw new Error('Invalid KB module configuration')
    }
    validateRepository(source.repository)
    ids.add(source.id)
    return { id: source.id, title: source.title, repository: source.repository, ref: source.ref, path: source.path }
  })
}

function validateRepository(repository: string): void {
  if (isAbsolute(repository) && !/[\x00-\x1f]/.test(repository)) return
  try {
    const url = new URL(repository)
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return
  } catch { /* Return only a constant error, never the repository value. */ }
  throw new Error('Invalid KB repository URL')
}

/** Each module publishes a complete in-memory generation after all I/O succeeds. */
export class ModuleKnowledgeBaseService extends FileKnowledgeBaseService {
  private readonly states = new Map<string, ModuleState>()
  private readonly snapshots = new Map<string, IndexedDocument[]>()
  private readonly pending = new Map<string, Promise<ModuleState | null>>()
  private timer?: ReturnType<typeof setInterval>
  private closed = false

  constructor(private readonly options: {
    root: string; dataDir: string; sources?: KbSource[]; files: KbFiles; git: KbGit; refreshMs?: number
  }, reranker?: KbSemanticReranker) {
    super(options.root, reranker, options.files)
    this.snapshots.set('core', this.documents)
    this.states.set('core', { id: 'core', title: 'Core', repository: null, ref: 'HEAD', path: 'docs/kb',
      status: 'ready', indexedSha: null, indexedAt: Date.now() })
    // Validate injected sources through the same path as file configuration.
    const sources = readKbSources(options.dataDir, options.files, options.sources ? JSON.stringify(options.sources) : undefined)
    for (const source of sources) this.states.set(source.id, { ...source, indexedSha: null, indexedAt: null, status: 'indexing' })
  }

  start(): void {
    if (this.timer || this.closed) return
    void this.refreshAll()
    const interval = Number.isFinite(this.options.refreshMs) ? this.options.refreshMs! : 600_000
    this.timer = setInterval(() => { void this.refreshAll() }, Math.max(1000, interval))
    this.timer.unref()
  }
  async close(): Promise<void> {
    this.closed = true
    clearInterval(this.timer)
    await Promise.all(this.pending.values())
  }
  async modules(): Promise<ModuleState[]> { return [...this.states.values()].map(state => ({ ...state })) }
  private async refreshAll(): Promise<void> {
    await Promise.all([...this.states.keys()].filter(id => id !== 'core').map(id => this.refreshModule(id)))
  }
  refreshModule(id: string): Promise<ModuleState | null> {
    if (this.closed || !this.states.has(id)) return Promise.resolve(null)
    const pending = this.pending.get(id)
    if (pending) return pending
    const task = this.refresh(id).finally(() => this.pending.delete(id))
    this.pending.set(id, task)
    return task
  }
  private async refresh(id: string): Promise<ModuleState> {
    const previous = this.states.get(id)!
    this.states.set(id, { ...previous, status: 'indexing', error: undefined })
    let phase = 'fetch'
    try {
      let root = this.options.root
      let sha: string | null = null
      if (previous.repository) {
        const checkout = await this.options.git.checkout({ ...previous, repository: previous.repository }, previous.indexedSha)
        sha = checkout.sha
        if (sha === previous.indexedSha && this.snapshots.has(id)) {
          const ready: ModuleState = { ...previous, status: 'ready', error: undefined }
          this.states.set(id, ready)
          return { ...ready }
        }
        root = checkout.root
      }
      phase = 'index'
      if (!this.options.files.exists(root)) throw new Error('Missing docs path')
      const documents = loadFileDocuments(root, id, previous.path, this.options.files)
      const ids = new Set(documents.map(item => item.document.id))
      if (ids.size !== documents.length) throw new Error('Duplicate document ID')
      this.snapshots.set(id, documents)
      this.documents = [...this.snapshots.values()].flat()
      this.byId = new Map(this.documents.map(item => [item.document.id, item]))
      const ready: ModuleState = { ...previous, indexedSha: sha, indexedAt: Date.now(), status: 'ready', error: undefined }
      this.states.set(id, ready)
      return { ...ready }
    } catch {
      const failed: ModuleState = { ...previous, status: 'failed', error: phase === 'fetch' ? 'KB source fetch failed' : 'KB source indexing failed' }
      this.states.set(id, failed)
      return { ...failed }
    }
  }
}

export function repositoryKey(value: string): string {
  return value.replace(/^git@([^:]+):/, 'https://$1/').replace(/^https?:\/\//, '').replace(/\.git\/?$/, '').replace(/\/$/, '')
}
