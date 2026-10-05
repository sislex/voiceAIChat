import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModuleKnowledgeBaseService, gitStoreCredentials, readKbSources, repositoryKey } from './sources.js'
import { PUBLIC_KB_VIEW } from './types.js'
import { registerKbRoutes } from './routes.js'
import { ScopedKnowledgeBase } from './scoped.js'
import type { VoiceChatDb } from '../db/database.js'
import { buildKbAutoContext } from './autoContext.js'

const dirs: string[] = []
const services: ModuleKnowledgeBaseService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map(kb => kb.close()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, {
  cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'KB test', GIT_AUTHOR_EMAIL: 'kb@example.test',
    GIT_COMMITTER_NAME: 'KB test', GIT_COMMITTER_EMAIL: 'kb@example.test' }, stdio: ['ignore', 'pipe', 'pipe']
}).trim()
function fixture(initializeGit = true) {
  const dir = mkdtempSync(join(tmpdir(), 'kb-modules-')); dirs.push(dir)
  const root = join(dir, 'core'); mkdirSync(root)
  writeFileSync(join(root, 'topic.md'), '---\nid: old-topic\nsymbols:\n  - Widget\n  - CoreOnly\n---\n# Core\n\nWidget core knowledge.')
  const work = join(dir, 'work'); mkdirSync(work)
  if (initializeGit) git(work, 'init', '--initial-branch=main')
  mkdirSync(join(work, 'docs/kb'), { recursive: true })
  writeFileSync(join(work, 'docs/kb/topic.md'), '---\nsymbols:\n  - Widget\n---\n# Remote\n\nWidget first version.')
  writeFileSync(join(work, 'README.md'), 'Outside sparse path')
  mkdirSync(join(work, 'src')); writeFileSync(join(work, 'src/app.ts'), 'outside')
  const bare = join(dir, 'remote.git')
  if (initializeGit) {
    git(work, 'add', '.'); git(work, 'commit', '-m', 'initial')
    git(dir, 'clone', '--bare', work, bare)
  }
  const source = { id: 'remote', title: 'Remote', repository: bare, ref: 'main', path: 'docs/kb' }
  const kb = new ModuleKnowledgeBaseService({ root, dataDir: dir, sources: [source] }); services.push(kb)
  return { dir, root, work, bare, kb, source }
}

describe('KB module sources', () => {
  it('indexes a shallow sparse checkout, namespaces IDs and keeps Core legacy IDs readable', async () => {
    const { kb, dir } = fixture()
    expect(await kb.refreshModule('remote')).toMatchObject({ status: 'ready', indexedSha: expect.any(String) })
    const checkout = join(dir, 'kb-cache/remote')
    expect(git(checkout, 'rev-parse', '--is-shallow-repository')).toBe('true')
    expect(existsSync(join(checkout, 'src/app.ts'))).toBe(false)
    expect(existsSync(join(checkout, 'README.md'))).toBe(false)
    expect(await kb.document('old-topic')).toMatchObject({ id: 'core:topic.md', module: 'core' })
    expect(await kb.document('core:old-topic')).toEqual(await kb.document('topic.md'))
    expect(await kb.document('remote:topic.md')).toMatchObject({ module: 'remote' })
    expect((await kb.topics()).map(d => d.id)).toEqual(['core:topic.md', 'remote:topic.md'])
    expect((await kb.search({ query: 'Widget', module: 'remote' })).map(d => d.module)).toEqual(['remote'])
    expect((await kb.context('Widget', 3500, { ...PUBLIC_KB_VIEW, module: 'remote' })).relatedDocuments).toEqual(['remote:topic.md'])
    expect(await kb.topics({ ...PUBLIC_KB_VIEW, module: 'missing' })).toEqual([])
  })

  it('publishes a new SHA atomically and retains its index and metadata on fetch or index failure', async () => {
    const { kb, work, bare, dir } = fixture()
    const initial = await kb.refreshModule('remote')
    const initialVersion = (await kb.status()).version
    expect(await kb.refreshModule('remote')).toEqual(initial)
    writeFileSync(join(work, 'docs/kb/topic.md'), '# Remote\n\nSecond version marker.')
    git(work, 'add', '.'); git(work, 'commit', '-m', 'update'); git(work, 'push', bare, 'main')
    const refresh = kb.refreshModule('remote')
    expect(kb.refreshModule('remote')).toBe(refresh)
    expect((await kb.document('remote:topic.md'))?.body).toContain('first version')
    const updated = await refresh
    expect(updated?.indexedSha).not.toBe(initial?.indexedSha)
    expect((await kb.status()).version).not.toBe(initialVersion)
    expect((await kb.document('remote:topic.md'))?.body).toContain('Second version')
    renameSync(bare, `${bare}.offline`)
    expect(await kb.refreshModule('remote')).toMatchObject({ status: 'failed', indexedSha: updated?.indexedSha, indexedAt: updated?.indexedAt, error: 'KB source fetch failed' })
    expect((await kb.document('remote:topic.md'))?.body).toContain('Second version')
    renameSync(`${bare}.offline`, bare)
    expect((await kb.refreshModule('remote'))?.status).toBe('ready')
    rmSync(join(work, 'docs/kb'), { recursive: true })
    git(work, 'add', '.'); git(work, 'commit', '-m', 'remove docs'); git(work, 'push', bare, 'main')
    expect((await kb.refreshModule('remote'))?.status).toBe('failed')
    expect((await kb.document('remote:topic.md'))?.body).toContain('Second version')
    expect(readFileSync(join(dir, 'kb-cache/remote/.git/config'), 'utf8')).not.toContain('Authorization')
  })

  it('rejects unsafe configuration and uses environment JSON before the data file', () => {
    const { dir, source } = fixture(false)
    writeFileSync(join(dir, 'kb-modules.json'), JSON.stringify([source]))
    expect(readKbSources(dir, JSON.stringify([]))).toEqual([])
    expect(readKbSources(dir, JSON.stringify([source]))).toEqual([source])
    const saved = process.env.VC_KB_MODULES
    delete process.env.VC_KB_MODULES
    try { expect(readKbSources(dir)).toEqual([source]) }
    finally { if (saved !== undefined) process.env.VC_KB_MODULES = saved }
    expect(() => readKbSources(dir, 'secret malformed JSON')).toThrow('Invalid KB module configuration')
    for (const patch of [{ id: 'core' }, { id: '../bad' }, { path: '../private' }, { repository: 'https://user:secret@example.test/repo' }, { ref: '--upload-pack=bad' }]) {
      expect(() => readKbSources(dir, JSON.stringify([{ ...source, ...patch }]))).toThrow('Invalid KB')
    }
    expect(repositoryKey('git@github.com:sislex/make.git')).toBe(repositoryKey('https://github.com/sislex/make'))
  })

  it('sanitizes credential failures without replacing a served index', async () => {
    const { dir, root, source } = fixture(false)
    const kb = new ModuleKnowledgeBaseService({ root, dataDir: dir, sources: [source], credentials: async () => { throw Error('secret-token-value') } })
    services.push(kb)
    expect(await kb.refreshModule('remote')).toMatchObject({ status: 'failed', error: 'KB source fetch failed' })
    expect(JSON.stringify(await kb.modules())).not.toContain('secret-token-value')
    expect(await kb.document('old-topic')).not.toBeNull()
  })

  it('uses the existing GitHub integration token only for GitHub HTTPS URLs', async () => {
    const fixturePassword = randomUUID()
    const credential = gitStoreCredentials(fixturePassword)
    expect(await credential('https://github.com/sislex/core.git')).toEqual({ username: 'x-access-token', password: fixturePassword })
    expect(await credential('/local/repository')).toBeNull()
  })

  it('checks immediately and every ten minutes, coalesces scheduling and stops on close', async () => {
    const { kb } = fixture(false)
    vi.useFakeTimers()
    const refresh = vi.spyOn(kb, 'refreshModule').mockResolvedValue(null)
    try {
      kb.start(); kb.start()
      expect(refresh).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(599_999)
      expect(refresh).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(refresh).toHaveBeenCalledTimes(2)
      await kb.close()
      await vi.advanceTimersByTimeAsync(600_000)
      expect(refresh).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('does not follow a repository docs symlink outside its checkout', async () => {
    const { work, bare, kb, root } = fixture()
    rmSync(join(work, 'docs/kb'), { recursive: true }); symlinkSync(root, join(work, 'docs/kb'))
    git(work, 'add', '.'); git(work, 'commit', '-m', 'symlink'); git(work, 'push', bare, 'main')
    expect((await kb.refreshModule('remote'))?.status).toBe('failed')
  })

  it('exposes module status, REST filters and admin-only refresh without a listener', async () => {
    const { kb } = fixture(); await kb.refreshModule('remote')
    const app = Fastify()
    app.addHook('preHandler', async req => { req.user = { name: 'test', role: req.headers['x-test-admin'] ? 'admin' : 'developer' } as typeof req.user })
    registerKbRoutes(app, kb)
    try {
      expect((await app.inject('/api/kb/modules')).json()).toHaveLength(2)
      expect((await app.inject('/api/kb/topics?module=remote')).json()).toHaveLength(1)
      expect((await app.inject('/api/kb/search?q=Widget&module=remote')).json()[0].module).toBe('remote')
      expect((await app.inject('/api/kb/context?q=Widget&module=remote')).json().relatedDocuments).toEqual(['remote:topic.md'])
      expect((await app.inject({ method: 'POST', url: '/api/kb/modules/remote/refresh' })).statusCode).toBe(403)
      expect((await app.inject({ method: 'POST', url: '/api/kb/modules/remote/refresh', headers: { 'x-test-admin': '1' } })).json().status).toBe('ready')
      expect((await app.inject({ method: 'POST', url: '/api/kb/modules/missing/refresh', headers: { 'x-test-admin': '1' } })).statusCode).toBe(404)
    } finally { await app.close() }
  })

  it('prefers the authorized project repository for autoContext and falls back for unmatched queries', async () => {
    const { kb, bare } = fixture(); await kb.refreshModule('remote')
    const getProject = vi.fn(async () => ({ gitUrl: bare }))
    const db = { projects: { getProject }, kb: { kbDocumentsVersion: async () => '1', kbDocuments: async () => [] } } as unknown as VoiceChatDb
    const scoped = new ScopedKnowledgeBase(kb, db)
    const view = { userId: 'user', projectIds: ['project'], projectId: 'project' }
    expect((await buildKbAutoContext(scoped, 'Widget', view)).bundle.relatedDocuments).toEqual(['remote:topic.md'])
    expect(await scoped.preferredModule({ ...view, projectIds: [] })).toBeUndefined()
    expect(getProject).toHaveBeenCalledTimes(1)
    expect((await buildKbAutoContext(scoped, 'CoreOnly', view)).bundle.relatedDocuments).toEqual(['core:topic.md'])
    expect(await scoped.preferredModule({ ...PUBLIC_KB_VIEW, repository: bare })).toBe('remote')
    expect(await scoped.topics({ ...view, module: 'remote' })).toHaveLength(1)
    expect((await scoped.context('Widget', 3500, { ...view, module: 'remote' })).relatedDocuments).toEqual(['remote:topic.md'])
  })
})

describe('KB module registration', () => {
  it('registers a repository once, persists the source list and indexes it', async () => {
    const { root, dir, bare } = fixture()
    const kb = new ModuleKnowledgeBaseService({ root, dataDir: join(dir, 'data') }); services.push(kb)
    const created = await kb.ensureSource({ repository: bare, title: 'Remote repo' })
    expect(created).toMatchObject({ id: 'remote', title: 'Remote repo', ref: 'main', path: 'docs/kb' })
    expect(await kb.ensureSource({ repository: bare })).toMatchObject({ id: 'remote' })
    expect(JSON.parse(readFileSync(join(dir, 'data/kb-modules.json'), 'utf8'))).toEqual([{ id: 'remote', title: 'Remote repo', repository: bare, ref: 'main', path: 'docs/kb' }])
    await vi.waitFor(async () => expect((await kb.modules()).find(m => m.id === 'remote')?.status).toBe('ready'))
    expect(await kb.document('remote:topic.md')).toMatchObject({ module: 'remote' })
    // A restart reads the persisted list.
    const restarted = new ModuleKnowledgeBaseService({ root, dataDir: join(dir, 'data') }); services.push(restarted)
    expect((await restarted.modules()).map(m => m.id)).toEqual(['core', 'remote'])
  })

  it('removes a registered module with its documents and never removes core', async () => {
    const { root, dir, bare } = fixture()
    const kb = new ModuleKnowledgeBaseService({ root, dataDir: join(dir, 'data') }); services.push(kb)
    await kb.ensureSource({ repository: bare })
    await kb.refreshModule('remote')
    expect(await kb.removeSource('core')).toBe(false)
    expect(await kb.removeSource('remote')).toBe(true)
    expect(await kb.document('remote:topic.md')).toBeNull()
    expect(JSON.parse(readFileSync(join(dir, 'data/kb-modules.json'), 'utf8'))).toEqual([])
  })

  it('refuses runtime registration when VC_KB_MODULES manages the list and rejects invalid repositories', async () => {
    const { root, dir, bare } = fixture()
    const managed = new ModuleKnowledgeBaseService({ root, dataDir: dir, sources: [], managedByEnv: true }); services.push(managed)
    await expect(managed.ensureSource({ repository: bare })).rejects.toThrow('kb_modules_managed_by_env')
    const kb = new ModuleKnowledgeBaseService({ root, dataDir: join(dir, 'other') }); services.push(kb)
    await expect(kb.ensureSource({ repository: 'https://user:secret@example.test/repo.git' })).rejects.toThrow('Invalid KB repository URL')
    expect(existsSync(join(dir, 'other/kb-modules.json'))).toBe(false)
  })
})
