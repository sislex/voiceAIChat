import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { isKbModuleId, type KbModule } from '@voicechat/shared'
import { FileKnowledgeBaseService, loadFileDocuments } from './service.js'
import type { IndexedDocument } from './engine.js'
import type { KbSemanticReranker } from './types.js'

export type KbSource = Pick<KbModule, 'id' | 'title' | 'repository' | 'ref' | 'path'>
export type ModuleState = KbModule & { error?: string }
const execute = promisify(execFile)

/** Operator-controlled configuration; no credentials are accepted in URLs. */
export function readKbSources(dataDir: string, override = process.env.VC_KB_MODULES): KbSource[] {
  const file = join(dataDir, 'kb-modules.json')
  let input: unknown
  try { input = JSON.parse(override ?? (existsSync(file) ? readFileSync(file, 'utf8') : '[]')) }
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

export interface GitCredential { username: string; password: string }
export type KbCredentials = (repository: string) => Promise<GitCredential | null>

/** Read the existing Git integration credential store; never persist its answer. */
export function gitStoreCredentials(githubToken?: string): KbCredentials {
  return async (repository) => {
    if (!repository.startsWith('https://')) return null
    const url = new URL(repository)
    if (url.hostname === 'github.com' && githubToken) return { username: 'x-access-token', password: githubToken }
    return new Promise((resolve) => {
      const child = execFile('git', ['credential', 'fill'], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false', GCM_INTERACTIVE: 'never' },
        timeout: 15_000, maxBuffer: 64 * 1024
      }, (error, stdout) => {
        if (error) return resolve(null)
        const fields = new Map(stdout.trim().split('\n').map(line => {
          const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]
        }))
        resolve(fields.get('password') ? { username: fields.get('username') ?? 'x-access-token', password: fields.get('password')! } : null)
      })
      child.stdin?.on('error', () => {})
      child.stdin?.end(`protocol=https\nhost=${url.host}\npath=${url.pathname.slice(1)}\n\n`)
    })
  }
}

/** Each module publishes a complete in-memory generation after all I/O succeeds. */
export class ModuleKnowledgeBaseService extends FileKnowledgeBaseService {
  private readonly states = new Map<string, ModuleState>()
  private readonly snapshots = new Map<string, IndexedDocument[]>()
  private readonly pending = new Map<string, Promise<ModuleState | null>>()
  private timer?: ReturnType<typeof setInterval>
  private closed = false

  constructor(private readonly options: {
    root: string; dataDir: string; sources?: KbSource[]; credentials?: KbCredentials; refreshMs?: number
  }, reranker?: KbSemanticReranker) {
    super(options.root, reranker)
    this.snapshots.set('core', this.documents)
    this.states.set('core', { id: 'core', title: 'Core', repository: null, ref: 'HEAD', path: 'docs/kb',
      status: 'ready', indexedSha: null, indexedAt: Date.now() })
    // Validate injected sources through the same path as file configuration.
    const sources = readKbSources(options.dataDir, options.sources ? JSON.stringify(options.sources) : undefined)
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
        const checkout = join(this.options.dataDir, 'kb-cache', id)
        mkdirSync(checkout, { recursive: true })
        const credential = await this.options.credentials?.(previous.repository)
        const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false',
          GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
          GIT_CONFIG_KEY_1: 'http.followRedirects', GIT_CONFIG_VALUE_1: 'false' }
        if (credential && previous.repository.startsWith('https://')) {
          env.GIT_CONFIG_COUNT = '3'
          env.GIT_CONFIG_KEY_2 = `http.${previous.repository}.extraHeader`
          env.GIT_CONFIG_VALUE_2 = `Authorization: Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`
        }
        const git = async (...args: string[]): Promise<string> => (await execute('git', args, {
          cwd: checkout, env, timeout: 60_000, maxBuffer: 2 * 1024 * 1024
        })).stdout.trim()
        if (!existsSync(join(checkout, '.git'))) await git('init', '--quiet')
        // A named promisor remote lets checkout lazily fetch blobs for the sparse path.
        // The URL is validated and contains no credentials.
        await git('config', 'remote.origin.url', previous.repository)
        await git('config', 'remote.origin.promisor', 'true')
        await git('config', 'remote.origin.partialclonefilter', 'blob:none')
        await git('config', 'core.sparseCheckout', 'true')
        // Non-cone mode excludes sibling/root files as well as sibling directories.
        await git('sparse-checkout', 'set', '--no-cone', `/${previous.path}/`)
        await git('fetch', '--depth', '1', '--filter=blob:none', '--no-tags', 'origin', previous.ref)
        sha = await git('rev-parse', 'FETCH_HEAD')
        if (sha === previous.indexedSha && this.snapshots.has(id)) {
          const ready: ModuleState = { ...previous, status: 'ready', error: undefined }
          this.states.set(id, ready)
          return { ...ready }
        }
        await git('checkout', '--force', '--detach', 'FETCH_HEAD')
        root = join(checkout, previous.path)
        // Reject a symlink in any component of the selected docs path.
        if (realpathSync(root) !== join(realpathSync(checkout), previous.path)) throw new Error('Invalid docs path')
      }
      phase = 'index'
      if (!existsSync(root)) throw new Error('Missing docs path')
      const documents = loadFileDocuments(root, id, previous.path)
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
