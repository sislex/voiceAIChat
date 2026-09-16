import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_DEVELOPMENT_PREVIEW, evaluateCiBrowserEvidence, normalizeCiBrowserCheck, normalizeDevelopmentPreview } from '@voicechat/shared'
import { DevelopmentPreviewManager, assertPreviewIsolation, browserCheckOutcome, type GatewayScope, type PreviewRuntime, type PreviewStore } from './development.js'

function harness(now = 1000) {
  let clock = now
  let saved: import('@voicechat/shared').PreviewStatus[] = []
  const prepared: Parameters<PreviewRuntime['prepare']>[0][] = []
  const stopped: Array<[string, boolean]> = []
  const scopes: GatewayScope[] = []
  const revoked: string[] = []
  const runtime: PreviewRuntime = {
    prepare: vi.fn(async input => { prepared.push(input); return { url: `http://${input.projectName}.preview.internal/` } }),
    stop: vi.fn(async (name, volumes) => { stopped.push([name, volumes]) }),
    logs: vi.fn(async () => 'token=abc postgres://u:p@prod/db\napplication ready')
  }
  const store: PreviewStore = { load: async () => structuredClone(saved), save: async value => { saved = structuredClone(value) } }
  const manager = new DevelopmentPreviewManager({
    runtime, store,
    gateway: { issue: async scope => { scopes.push(scope); return 'scoped-secret' }, revoke: async hash => { revoked.push(hash) } },
    now: () => clock, ttlMs: 500
  })
  const input = (runId = 'run-1') => ({
    projectId: 'project-1', taskId: 'task-1', runId, worktree: '/worktrees/task-1', sha: 'abcdef123456',
    settings: normalizeDevelopmentPreview({ ...DEFAULT_DEVELOPMENT_PREVIEW, enabled: true, cli: { enabled: true, allowedOperations: ['codex'], tokenTtlMs: 10_000 } }),
    environment: { TZ: 'UTC' }
  })
  return { manager, input, runtime, prepared, stopped, scopes, revoked, saved: () => saved, advance: (ms: number) => { clock += ms } }
}

describe('development Docker preview', () => {
  // @testCase TC-API-01
  it('normalizes legacy settings to preview off and continue', () => {
    expect(normalizeDevelopmentPreview(undefined)).toEqual(DEFAULT_DEVELOPMENT_PREVIEW)
    expect(normalizeCiBrowserCheck({ mode: 'chromium', devServerPort: 5173, startPath: '/' }).failurePolicy).toBe('continue')
    expect(normalizeCiBrowserCheck({ mode: 'chromium', failurePolicy: 'block' }).failurePolicy).toBe('block')
  })

  // @testCase TC-INT-01
  // @testCase TC-E2E-01
  it('creates unique run resources, isolated DB and restarts from the current SHA', async () => {
    const h = harness()
    const first = await h.manager.start(h.input('run-a'))
    const second = await h.manager.start(h.input('run-b'))
    expect(first.status.id).not.toBe(second.status.id)
    expect(first.status.state).toBe('ready')
    expect(first.status.testDatabase).toMatchObject({ ready: true })
    expect(h.prepared[0]).toMatchObject({ worktree: '/worktrees/task-1', sha: 'abcdef123456' })
    expect(h.prepared[0].env).not.toHaveProperty('HOME')
    const restarted = await h.manager.restart({ ...h.input('run-a'), sha: '1234567abcdef' })
    expect(restarted.status.sha).toBe('1234567abcdef')
    expect(h.stopped[0]?.[1]).toBe(true)
  })

  // @testCase TC-NEG-01
  it('rejects production resources and secrets before runtime starts', async () => {
    const h = harness()
    expect(() => assertPreviewIsolation({ ...h.input(), environment: { DATABASE_URL: 'postgres://prod.internal/main' }, productionDatabaseHosts: ['prod.internal'] })).toThrow(/Production/)
    expect(() => assertPreviewIsolation({ ...h.input(), environment: { HOME: '/Users/admin' } })).toThrow(/Секретная/)
    expect(h.runtime.prepare).not.toHaveBeenCalled()
  })

  // @testCase TC-INT-02
  it('scopes gateway tokens and revokes them during idempotent cleanup', async () => {
    const h = harness()
    const started = await h.manager.start(h.input())
    expect(started.gatewayToken).toBe('scoped-secret')
    expect(h.manager.authorize('scoped-secret', { projectId: 'project-1', taskId: 'task-1', runId: 'run-1', model: 'codex', operation: 'codex' })).toBe(true)
    expect(h.manager.authorize('scoped-secret', { projectId: 'project-1', taskId: 'task-1', runId: 'other', model: 'codex', operation: 'codex' })).toBe(false)
    await h.manager.stop('run-1'); await h.manager.stop('run-1')
    expect(h.revoked).toHaveLength(1)
    expect(h.manager.authorize('scoped-secret', { projectId: 'project-1', taskId: 'task-1', runId: 'run-1', model: 'codex', operation: 'codex' })).toBe(false)
  })

  // @testCase TC-INT-03
  // @testCase TC-E2E-02
  it('continues on infrastructure failure by default and retains safe diagnostics', async () => {
    const evidence = evaluateCiBrowserEvidence([{ action: 'open', ok: false, target: false, infrastructureError: true }])
    expect(browserCheckOutcome(evidence, 'continue', 'docker_unavailable')).toMatchObject({ status: 'skipped', diagnosticCode: 'docker_unavailable' })
    const h = harness()
    const logs = await (async () => { await h.manager.start(h.input()); return h.manager.logs('run-1') })()
    expect(logs).toContain('[REDACTED]')
    expect(logs).not.toContain('postgres://')
  })

  // @testCase TC-INT-04
  it('blocks only when the user explicitly selected block', () => {
    const incomplete = evaluateCiBrowserEvidence([])
    expect(browserCheckOutcome(incomplete, 'continue').status).toBe('warning')
    expect(browserCheckOutcome(incomplete, 'block').status).toBe('blocked')
  })

  // @testCase TC-NEG-02
  it('never passes narrative, HTTP success, stale or incomplete browser evidence', () => {
    expect(browserCheckOutcome(null, 'block').status).toBe('blocked')
    expect(evaluateCiBrowserEvidence([{ action: 'open', ok: true, target: true, requestedTarget: false }]).status).not.toBe('passed')
    expect(evaluateCiBrowserEvidence([{ action: 'open', ok: true, target: true, requestedTarget: true, width: 1440 }]).status).not.toBe('passed')
  })

  // @testCase TC-INT-05
  it('expires resources, restores durable state and garbage-collects orphans', async () => {
    const h = harness()
    await h.manager.start(h.input())
    h.advance(501)
    expect(await h.manager.collectExpired()).toEqual(['run-1'])
    expect(h.manager.status('run-1')).toMatchObject({ state: 'expired', url: null })
    const restored = new DevelopmentPreviewManager({ runtime: h.runtime, store: { load: async () => h.saved(), save: async () => undefined }, gateway: { issue: async () => '', revoke: async () => undefined }, now: () => 2000 })
    await restored.restore()
    expect(restored.status('run-1')?.state).toBe('expired')
    expect(await restored.reconcile(['orphan-project'])).toEqual(['orphan-project'])
  })
})

