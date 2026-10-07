import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseOwnerModules, reconcileOwnerModules } from './ownerModules.js'
import { ModuleKnowledgeBaseService as Registry } from './moduleService.js'
import { kbFiles } from './files.js'
import { ModuleKnowledgeBaseService } from './sources.js'
import { registerKbRoutes } from './routes.js'
import type { VoiceChatDb } from '../db/database.js'

const map = readFileSync(new URL('../../../../docs/kb/modules.md', import.meta.url), 'utf8')
// Order of docs/kb/modules.md rows that have a knowledge base.
const ids = ['core', 'core-ui', 'ui', 'make', 'agent', 'playwright-reader', 'web-reader', 'kanban', 'llm-runner', 'image-studio', 'voice']
const dirs: string[] = [], services: ModuleKnowledgeBaseService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.close()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function fixture(managedByEnv = false) {
  const dir = mkdtempSync(join(tmpdir(), 'kb-owner-')); dirs.push(dir)
  const ownerMap = join(dir, 'modules.md'); writeFileSync(ownerMap, map)
  const duplicate = { id: 'voiceaichat', title: 'Duplicate', repository: 'https://github.com/sislex/voiceAIChat.git', ref: 'main', path: 'docs/kb' }
  const source = { id: 'custom', title: 'Custom', repository: 'https://github.com/example/custom.git', ref: 'main', path: 'docs/kb' }
  const kb = new ModuleKnowledgeBaseService({ root: dir, dataDir: dir, ownerMap, sources: [duplicate, source], managedByEnv })
  services.push(kb)
  // Registration/persistence are real; fetching remote repositories is outside these unit tests.
  const refresh = vi.spyOn(kb, 'refreshModule').mockResolvedValue(null)
  return { kb, dir, ownerMap, refresh }
}

describe('owner module map', () => {
  it('reads the actual map with exact IDs and skips all rows marked нет', () => {
    const sources = parseOwnerModules(map)
    expect(sources.map(source => source.id)).toEqual(ids)
    expect(sources.find(source => source.id === 'playwright-reader')).toEqual({
      id: 'playwright-reader', title: 'playwright-reader', repository: 'https://github.com/sislex/playwrightreader.git', ref: 'main', path: 'docs/kb'
    })
  })
  it.each([
    ['`make:README.md`', '`other:README.md`'],
    ['`sislex/make`', '`https://github.com/sislex/make`'],
    ['`make` |', '`agent` |'],
    ['нет (пока не заведена)', 'unknown'],
    ['|---|---|---|---|', '|---|---|'],
    ['Knowledge base', 'Knowledge bases'],
    ['`make:README.md` (`docs/kb`)', '`make:README.md` (`../kb`)']
  ])('rejects malformed map: %s', (before, after) => {
    expect(() => parseOwnerModules(map.replace(before, after))).toThrow('Invalid KB owner module map')
  })
})

describe('owner module reconciliation', () => {
  it('removes indexed duplicate documents and indexes registered owners through the knowledge engine', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-owner-index-')); dirs.push(dir)
    writeFileSync(join(dir, 'topic.md'), '# Owner topic\n\nKnowledge from the repository.')
    const saved: unknown[] = []
    const kb = new Registry({ root: dir, dataDir: dir, files: kbFiles,
      git: { checkout: async () => ({ root: dir, sha: 'owner-sha' }) },
      writeSources: sources => { saved.push(sources) },
      sources: [{ id: 'voiceaichat', title: 'Old Core', repository: 'https://github.com/sislex/voiceAIChat.git', ref: 'main', path: 'docs/kb' }]
    })
    try {
      await kb.refreshModule('voiceaichat')
      expect(await kb.document('voiceaichat:topic.md')).not.toBeNull()
      await reconcileOwnerModules(kb, map)
      await Promise.all(ids.slice(1).map(id => kb.refreshModule(id)))
      expect(await kb.document('voiceaichat:topic.md')).toBeNull()
      expect(await kb.document('core:topic.md')).not.toBeNull()
      expect(await kb.document('playwright-reader:topic.md')).toMatchObject({ module: 'playwright-reader' })
      expect((await kb.modules()).every(module => module.status === 'ready')).toBe(true)
      expect(saved).toHaveLength(ids.length)
    } finally { await kb.close() }
  })
  it('refuses owner ID collisions without replacing unrelated sources', async () => {
    const { kb } = fixture()
    await kb.ensureSource({ id: 'agent', repository: 'https://github.com/example/unrelated.git' })
    await expect(kb.reconcileModules()).rejects.toThrow('kb_module_id_conflict')
    expect((await kb.modules()).find(module => module.id === 'agent')?.repository).toBe('https://github.com/example/unrelated.git')
  })
  it('is idempotent, persists exact IDs, preserves other sources and removes the Core duplicate', async () => {
    const { kb, dir, refresh } = fixture()
    const first = kb.reconcileModules()
    expect(kb.reconcileModules()).toBe(first)
    expect((await first).map(module => module.id)).toEqual(['core', 'custom', ...ids.slice(1)])
    expect(await kb.ensureSource({ repository: 'git@github.com:sislex/voiceAIChat.git' })).toMatchObject({ id: 'core' })
    expect(await kb.ensureSource({ repository: 'https://github.com/SISLEX/VOICEAICHAT/' })).toMatchObject({ id: 'core' })
    const persisted = readFileSync(join(dir, 'kb-modules.json'), 'utf8')
    await kb.reconcileModules()
    expect(readFileSync(join(dir, 'kb-modules.json'), 'utf8')).toBe(persisted)
    expect(refresh).toHaveBeenCalledTimes(ids.length - 1)
    const restarted = new ModuleKnowledgeBaseService({ root: dir, dataDir: dir }); services.push(restarted)
    expect((await restarted.modules()).map(module => module.id)).toEqual(['core', 'custom', ...ids.slice(1)])
  })
  it('preserves the environment-managed list and does not even read the owner map', async () => {
    const { kb, ownerMap, refresh } = fixture(true)
    rmSync(ownerMap)
    const original = await kb.modules()
    expect(await kb.reconcileModules()).toEqual(original)
    await expect(kb.ensureSource({ repository: 'https://github.com/sislex/make.git' })).rejects.toThrow('kb_modules_managed_by_env')
    expect(await kb.ensureSource({ repository: 'https://github.com/sislex/voiceAIChat.git' })).toMatchObject({ id: 'core' })
    expect(refresh).not.toHaveBeenCalled()
  })
  it('validates the complete map before removing duplicates or registering sources', async () => {
    const { kb, ownerMap } = fixture()
    const original = await kb.modules()
    writeFileSync(ownerMap, map.replace('`kanban:README.md`', '`wrong:README.md`'))
    await expect(kb.reconcileModules()).rejects.toThrow('Invalid KB owner module map')
    expect(await kb.modules()).toEqual(original)
    writeFileSync(ownerMap, map)
    await expect(kb.reconcileModules()).resolves.toHaveLength(ids.length + 1)
  })
  it('migrates an existing generated repository ID to the stable owner ID', async () => {
    const { kb } = fixture()
    expect(await kb.ensureSource({ repository: 'https://github.com/sislex/sislexa-core-ui.git' })).toMatchObject({ id: 'sislexa-core-ui' })
    await kb.reconcileModules()
    expect((await kb.modules()).map(module => module.id)).toContain('core-ui')
    expect((await kb.modules()).map(module => module.id)).not.toContain('sislexa-core-ui')
  })
  it('requires admin for the route and returns the reconciled modules without listening', async () => {
    const { kb, ownerMap } = fixture()
    const app = Fastify()
    app.addHook('preHandler', async req => {
      if (req.headers['x-role']) req.user = { name: 'test', role: req.headers['x-role'] } as typeof req.user
    })
    const reconcileModules = vi.fn(() => kb.reconcileModules())
    registerKbRoutes(app, kb, { db: {} as VoiceChatDb, toolEnabled: false, reconcileModules })
    try {
      for (const headers of [{}, { 'x-role': 'developer' }]) {
        expect((await app.inject({ method: 'POST', url: '/api/kb/modules/reconcile', headers })).statusCode).toBe(403)
      }
      expect(reconcileModules).not.toHaveBeenCalled()
      const response = await app.inject({ method: 'POST', url: '/api/kb/modules/reconcile', headers: { 'x-role': 'admin' } })
      expect(response.statusCode).toBe(200)
      expect(response.json().map((module: { id: string }) => module.id)).toEqual(['core', 'custom', ...ids.slice(1)])
      writeFileSync(ownerMap, 'invalid')
      const failed = await app.inject({ method: 'POST', url: '/api/kb/modules/reconcile', headers: { 'x-role': 'admin' } })
      expect(failed.statusCode).toBe(500)
      expect(failed.json()).toEqual({ error: 'KB module reconciliation failed' })
    } finally { await app.close() }
  })
})
