// Core owns runtime module registration policy; indexing uses the knowledge engine.
import type { KbFiles, KbGit } from '../../../../packages/knowledge/src/ports.js'
import { FileKnowledgeBaseService, loadFileDocuments } from '../../../../packages/knowledge/src/service.js'
import type { IndexedDocument } from '../../../../packages/knowledge/src/engine.js'
import type { KbSemanticReranker } from './types.js'
import { readKbSources, repositoryKey, type KbSource, type ModuleState } from '../../../../packages/knowledge/src/sources.js'
import { isCoreRepository } from './ownerModules.js'

/** Each module publishes a complete in-memory generation after all I/O succeeds. */
export class ModuleKnowledgeBaseService extends FileKnowledgeBaseService {
  private readonly states = new Map<string, ModuleState>()
  private readonly snapshots = new Map<string, IndexedDocument[]>()
  private readonly pending = new Map<string, Promise<ModuleState | null>>()
  private timer?: ReturnType<typeof setInterval>
  private closed = false

  constructor(private readonly options: {
    root: string; dataDir: string; sources?: KbSource[]; files: KbFiles; git: KbGit; refreshMs?: number
    /** Persists runtime-registered sources; absent means registration is unavailable. */
    writeSources?: (sources: KbSource[]) => void
    /** Sources come from VC_KB_MODULES: runtime registration is refused instead of being silently lost. */
    managedByEnv?: boolean
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

  /** Register a repository knowledge base or return the module already serving it; indexing starts in the background. */
  async ensureSource(input: { id?: string; repository: string; ref?: string; path?: string; title?: string }): Promise<ModuleState> {
    if (isCoreRepository(input.repository)) return { ...this.states.get('core')! }
    const ref = input.ref ?? 'main', path = input.path ?? 'docs/kb'
    const key = repositoryKey(input.repository)
    const existing = [...this.states.values()].find(state => state.repository && repositoryKey(state.repository) === key && state.ref === ref && state.path === path)
    if (existing && (!input.id || existing.id === input.id || this.options.managedByEnv)) return { ...existing }
    if (this.options.managedByEnv) throw new Error('kb_modules_managed_by_env')
    if (!this.options.writeSources) throw new Error('kb_modules_unavailable')
    const base = (key.split('/').pop() ?? 'module').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'module'
    let id = input.id ?? base
    if (input.id && this.states.has(id)) throw new Error('kb_module_id_conflict')
    if (!input.id) for (let n = 2; this.states.has(id); n++) id = `${base}-${n}`
    const source: KbSource = { id, title: input.title?.trim() || key.split('/').pop() || id, repository: input.repository, ref, path }
    // Validate exactly like file configuration before anything is stored.
    readKbSources(this.options.dataDir, this.options.files, JSON.stringify([...this.sources(), source]))
    if (existing) await this.removeSource(existing.id)
    this.states.set(id, { ...source, indexedSha: null, indexedAt: null, status: 'indexing' })
    this.options.writeSources(this.sources())
    void this.refreshModule(id)
    return { ...this.states.get(id)! }
  }

  /** Remove a registered module and its documents; the Core module cannot be removed. */
  async removeSource(id: string): Promise<boolean> {
    if (id === 'core' || !this.states.has(id)) return false
    if (this.options.managedByEnv) throw new Error('kb_modules_managed_by_env')
    await this.pending.get(id)
    this.states.delete(id)
    this.snapshots.delete(id)
    this.documents = [...this.snapshots.values()].flat()
    this.byId = new Map(this.documents.map(item => [item.document.id, item]))
    this.options.writeSources?.(this.sources())
    return true
  }

  private sources(): KbSource[] {
    return [...this.states.values()].filter(state => state.id !== 'core')
      .map(({ id, title, repository, ref, path }) => ({ id, title, repository: repository!, ref, path }))
  }
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
