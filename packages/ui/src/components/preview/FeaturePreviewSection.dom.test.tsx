import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import type { PreviewEnvironment, PreviewState } from '@shared/preview'
import { FeaturePreviewSection } from './FeaturePreviewSection'

function environment(state: PreviewState): PreviewEnvironment {
  return {
    id: 'e1', projectId: 'p1', taskId: 't1', agentId: 'a1', workspacePath: '/repos/p1/t1',
    branch: 'feature/1', builtCommitSha: 'abc123456789', currentCommitSha: state === 'stale' ? 'def123456789' : 'abc123456789',
    state, staleReason: state === 'stale' ? 'commit_changed' : null, composeProject: 'vc-preview-p1-t1',
    appUrl: state === 'running' || state === 'stale' ? '/preview/e1/app' : null, storybookUrl: null,
    storybookStatus: 'not_applicable', storybookCommitSha: null, selectedSeedScenario: null,
    seedVersion: null, dataReady: false, healthStatus: state === 'running' || state === 'stale' ? 'healthy' : 'unknown',
    services: [], runs: [], createdBy: 'u1', createdAt: 1, updatedAt: 1, startedAt: null, stoppedAt: null,
    lastError: state === 'failed' ? { type: 'build', message: 'boom' } : null
  }
}
afterEach(() => { delete window.featurePreview })

describe('FeaturePreviewSection', () => {
  it.each([
    ['not_created','Не создано'], ['building','Сборка'], ['running','Работает'], ['stale','Окружение устарело'],
    ['stopped','Остановлено'], ['failed','Ошибка'], ['cleaning','Удаление'], ['removed','Удалено']
  ] as const)('renders server state %s', async (state, label) => {
    window.featurePreview = { get: vi.fn().mockResolvedValue(state === 'not_created' ? null : environment(state)), operate: vi.fn(), cancel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    expect(await screen.findByText(label)).toBeInTheDocument()
  })

  it('starts only after explicit click', async () => {
    const operate = vi.fn().mockResolvedValue(environment('building'))
    window.featurePreview = { get: vi.fn().mockResolvedValue(null), operate, cancel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    await screen.findByText('Не создано')
    expect(operate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Запустить тестовый контейнер' }))
    await waitFor(() => expect(operate).toHaveBeenCalledWith('p1', 't1', 'start', expect.objectContaining({ idempotencyKey: expect.any(String) })))
  })

  it('starts when Web Crypto has no randomUUID', async () => {
    const original = globalThis.crypto
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => { bytes.fill(7); return bytes }
    })
    const operate = vi.fn().mockResolvedValue(environment('building'))
    window.featurePreview = { get: vi.fn().mockResolvedValue(null), operate, cancel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Запустить тестовый контейнер' }))
    await waitFor(() => expect(operate).toHaveBeenCalledWith('p1', 't1', 'start', {
      idempotencyKey: '07070707-0707-4707-8707-070707070707'
    }))
    vi.stubGlobal('crypto', original)
  })

  it('offers to start Docker when the server reports a stopped Engine', async () => {
    const failed = { ...environment('failed'), lastError: { type: 'docker' as const, message: 'Docker установлен, но не запущен' } }
    const operate = vi.fn().mockResolvedValue(environment('starting'))
    window.featurePreview = { get: vi.fn().mockResolvedValue(failed), operate, cancel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Запустить Docker' }))
    await waitFor(() => expect(operate).toHaveBeenCalledWith('p1', 't1', 'docker_start', expect.objectContaining({ idempotencyKey: expect.any(String) })))
  })

  it('warns about stale SHA and offers rebuild', async () => {
    window.featurePreview = { get: vi.fn().mockResolvedValue(environment('stale')), operate: vi.fn().mockResolvedValue(environment('rebuilding')), cancel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    expect(await screen.findByText(/Playwright требует пересборку/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Пересобрать' })).toBeEnabled()
  })
})
