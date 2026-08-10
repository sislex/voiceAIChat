import { describe, expect, it } from 'vitest'
import { PREVIEW_STATES, canRunPlaywright, previewActions, safePreviewResourceName, type PreviewEnvironment } from './preview'

function env(patch: Partial<PreviewEnvironment> = {}): PreviewEnvironment {
  return {
    id: 'e1', projectId: 'Project / PROD', taskId: 'Task; rm -rf', agentId: 'a1',
    workspacePath: '/repos/p/1', branch: 'feature/1', expectedCommitSha: 'abc', builtCommitSha: 'abc',
    currentCommitSha: 'abc', gitStatus: 'verified', state: 'running', staleReason: null,
    composeProject: 'vc-preview-projectprod-taskrmrf', appUrl: 'https://preview/app',
    storybookUrl: null, storybookStatus: 'not_applicable', storybookCommitSha: null,
    selectedSeedScenario: 'basic', seedVersion: 'v1', dataReady: true,
    healthStatus: 'healthy', services: [], runs: [], createdBy: 'u1',
    createdAt: 1, updatedAt: 1, startedAt: 1, stoppedAt: null, lastError: null,
    ...patch
  }
}

describe('feature preview contract', () => {
  it('contains every persisted state', () => {
    expect(PREVIEW_STATES).toEqual([
      'not_created','queued','building','starting','seeding','health_checking',
      'running','stale','stopping','stopped','rebuilding','failed','cleaning','removed'
    ])
  })

  it.each([
    ['not_created', ['start']],
    ['building', []],
    ['running', ['rebuild','stop','seed','reset','health_check','remove']],
    ['stale', ['rebuild','stop','seed','reset','health_check','remove']],
    ['stopped', ['start','rebuild','remove']],
    ['cleaning', []],
    ['removed', ['start']]
  ] as const)('maps %s to allowed mutations', (state, expected) => {
    expect(previewActions(state)).toEqual(expected)
  })

  it('rejects Playwright for stale, unhealthy, mismatched SHA and missing seed', () => {
    expect(canRunPlaywright(env({ state: 'stale' }), 'abc').ok).toBe(false)
    expect(canRunPlaywright(env({ healthStatus: 'unhealthy' }), 'abc').ok).toBe(false)
    expect(canRunPlaywright(env(), 'def').ok).toBe(false)
    expect(canRunPlaywright(env({ dataReady: false }), 'abc').ok).toBe(false)
    expect(canRunPlaywright(env(), 'abc')).toEqual({ ok: true, url: 'https://preview/app', seedScenario: 'basic' })
  })

  it('never uses task title or shell characters in Docker resource names', () => {
    expect(safePreviewResourceName('Project / PROD', 'Task; rm -rf')).toBe('vc-preview-projectprod-taskrmrf')
    expect(safePreviewResourceName('Project / PROD', 'Task; rm -rf')).toMatch(/^[a-z0-9-]+$/)
  })
})
