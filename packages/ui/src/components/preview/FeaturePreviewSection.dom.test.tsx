import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import type { PreviewEnvironment, PreviewState } from '@shared/preview'
import { FeaturePreviewSection } from './FeaturePreviewSection'

function environment(state: PreviewState): PreviewEnvironment {
  return {
    id: 'e1', projectId: 'p1', taskId: 't1', agentId: 'a1', workspacePath: '/repos/p1/t1',
    branch: 'feature/1', expectedCommitSha: 'abc123456789', builtCommitSha: 'abc123456789', currentCommitSha: state === 'stale' ? 'def123456789' : 'abc123456789', gitStatus: state === 'stale' ? 'sha_mismatch' : 'verified',
    state, staleReason: state === 'stale' ? 'commit_changed' : null, composeProject: 'vc-preview-p1-t1',
    appUrl: state === 'running' || state === 'stale' ? '/preview/e1/app' : null, storybookUrl: null,
    storybookStatus: 'not_applicable', storybookCommitSha: null, selectedSeedScenario: null,
    seedVersion: null, dataReady: false, healthStatus: state === 'running' || state === 'stale' ? 'healthy' : 'unknown',
    services: [], runs: [], createdBy: 'u1', createdAt: 1, updatedAt: 1, startedAt: null, stoppedAt: null,
    lastError: state === 'failed' ? { type: 'build_failed', message: 'boom' } : null
  }
}
afterEach(() => { delete window.featurePreview })

describe('FeaturePreviewSection', () => {
  it.each([
    ['not_created','Не создано'], ['building','Сборка'], ['running','Работает'], ['stale','Окружение устарело'],
    ['stopped','Остановлено'], ['failed','Ошибка'], ['cleaning','Удаление'], ['removed','Удалено']
  ] as const)('renders server state %s', async (state, label) => {
    window.featurePreview = { get: vi.fn().mockResolvedValue(state === 'not_created' ? null : environment(state)), operate: vi.fn(), cancel: vi.fn(), open: vi.fn(), closeTunnel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    expect(await screen.findByText(label)).toBeInTheDocument()
  })

  it('starts only after explicit click', async () => {
    const operate = vi.fn().mockResolvedValue(environment('building'))
    window.featurePreview = { get: vi.fn().mockResolvedValue(null), operate, cancel: vi.fn(), open: vi.fn(), closeTunnel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    await screen.findByText('Не создано')
    expect(operate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Запустить тестовый контейнер' }))
    await waitFor(() => expect(operate).toHaveBeenCalledWith('p1', 't1', 'start', expect.objectContaining({ idempotencyKey: expect.any(String) })))
  })

  it('shows launch feedback immediately and blocks a duplicate request', async () => {
    let resolve!: (value: PreviewEnvironment) => void
    const operate = vi.fn(() => new Promise<PreviewEnvironment>((done) => { resolve = done }))
    window.featurePreview = { get: vi.fn().mockResolvedValue(null), operate, cancel: vi.fn(), open: vi.fn(), closeTunnel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    const button = await screen.findByRole('button', { name: 'Запустить тестовый контейнер' })
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Запускаем тестовый контейнер…' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Прогресс запуска тестового контейнера' })).not.toHaveAttribute('aria-valuenow')
    fireEvent.click(screen.getByRole('button', { name: 'Запускаем тестовый контейнер…' }))
    expect(operate).toHaveBeenCalledTimes(1)
    resolve(environment('building'))
    await waitFor(() => expect(screen.getByText('Сборка')).toBeInTheDocument())
  })

  it('turns a rejected launch request into a terminal visible error', async () => {
    window.featurePreview = { get: vi.fn().mockResolvedValue(null), operate: vi.fn().mockRejectedValue(new Error('Машина недоступна')), cancel: vi.fn(), open: vi.fn(), closeTunnel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Запустить тестовый контейнер' }))
    expect(await screen.findByText('Машина недоступна')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Запустить тестовый контейнер' })).toBeEnabled()
  })

  it('starts when Web Crypto has no randomUUID', async () => {
    const original = globalThis.crypto
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => { bytes.fill(7); return bytes }
    })
    const operate = vi.fn().mockResolvedValue(environment('building'))
    window.featurePreview = { get: vi.fn().mockResolvedValue(null), operate, cancel: vi.fn(), open: vi.fn(), closeTunnel: vi.fn() }
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
    window.featurePreview = { get: vi.fn().mockResolvedValue(failed), operate, cancel: vi.fn(), open: vi.fn(), closeTunnel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Запустить Docker' }))
    await waitFor(() => expect(operate).toHaveBeenCalledWith('p1', 't1', 'docker_start', expect.objectContaining({ idempotencyKey: expect.any(String) })))
  })

  it('warns about stale SHA and offers rebuild', async () => {
    window.featurePreview = { get: vi.fn().mockResolvedValue(environment('stale')), operate: vi.fn().mockResolvedValue(environment('rebuilding')), cancel: vi.fn(), open: vi.fn(), closeTunnel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    expect(await screen.findByText(/Для QA требуется пересборка/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Пересобрать' })).toBeEnabled()
  })

  it('opens a ready project through the bridge and shows tunnel state', async () => {
    const ready = { ...environment('running'), services: [{ name: 'app', internalPort: 3000, hostPort: 18000, url: 'http://127.0.0.1:18000', containerId: 'c1', state: 'running', healthStatus: 'healthy' as const }] }
    const open = vi.fn().mockResolvedValue({ connectionType: 'tunnel', state: 'connected', url: 'http://127.0.0.1:32100', tunnelId: 'tun1', manualCommand: null, internalUrl: ready.appUrl!, localAgentId: 'local', error: null })
    const browserOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    window.featurePreview = { get: vi.fn().mockResolvedValue(ready), operate: vi.fn(), cancel: vi.fn(), open, closeTunnel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть проект' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('p1', 't1', 'app'))
    expect(browserOpen).toHaveBeenCalledWith('http://127.0.0.1:32100', '_blank', 'noopener,noreferrer')
    expect(screen.getByText(/защищённый туннель/)).toBeInTheDocument()
  })

  it('shows Storybook separately and renders the manual fallback without horizontal-only data', async () => {
    const ready = { ...environment('running'), storybookUrl: 'http://127.0.0.1:18001', storybookStatus: 'ready' as const, services: [{ name: 'storybook', internalPort: 6006, hostPort: 18001, url: 'http://127.0.0.1:18001', containerId: 'c2', state: 'running', healthStatus: 'healthy' as const }] }
    const open = vi.fn().mockResolvedValue({ connectionType: 'manual', state: 'agent_required', url: null, tunnelId: null, manualCommand: 'ssh -N -L 18000:127.0.0.1:18001 preview@example.test', internalUrl: ready.storybookUrl, localAgentId: null, error: 'Для автоматического подключения нужен локальный агент ChatAI' })
    window.featurePreview = { get: vi.fn().mockResolvedValue(ready), operate: vi.fn(), cancel: vi.fn(), open, closeTunnel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть Storybook' }))
    expect(await screen.findByText(/ssh -N -L/)).toHaveTextContent('ssh -N -L 18000:127.0.0.1:18001 preview@example.test')
    expect(screen.getByText(/Пароли и SSH-ключи остаются/)).toBeInTheDocument()
  })

  it('opens a local preview host port without tunnel or manual SSH UI', async () => {
    const ready = { ...environment('running'), services: [{ name: 'app', internalPort: 3000, hostPort: 18123, url: 'http://127.0.0.1:18123', containerId: 'c1', state: 'running', healthStatus: 'healthy' as const }] }
    const open = vi.fn().mockResolvedValue({ connectionType: 'direct', state: 'connected', url: 'http://127.0.0.1:18123', tunnelId: null, manualCommand: null, internalUrl: ready.appUrl!, localAgentId: 'a1', error: null })
    const browserOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    window.featurePreview = { localAgentId: 'a1', get: vi.fn().mockResolvedValue(ready), operate: vi.fn(), cancel: vi.fn(), open, closeTunnel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть проект' }))
    await waitFor(() => expect(browserOpen).toHaveBeenCalledWith('http://127.0.0.1:18123', '_blank', 'noopener,noreferrer'))
    expect(screen.queryByRole('button', { name: 'Копировать команду' })).not.toBeInTheDocument()
    expect(screen.queryByText(/SSH/)).not.toBeInTheDocument()
  })

  it('explains missing explicit SSH settings without constructing a command', async () => {
    const ready = { ...environment('running'), services: [{ name: 'app', internalPort: 3000, hostPort: 18000, url: 'http://127.0.0.1:18000', containerId: 'c1', state: 'running', healthStatus: 'healthy' as const }] }
    const open = vi.fn().mockResolvedValue({ connectionType: 'manual', state: 'agent_required', url: null, tunnelId: null, manualCommand: null, internalUrl: ready.appUrl!, localAgentId: null, missingSshSettings: ['hostname', 'user'], error: 'missing settings' })
    window.featurePreview = { get: vi.fn().mockResolvedValue(ready), operate: vi.fn(), cancel: vi.fn(), open, closeTunnel: vi.fn() }
    render(<FeaturePreviewSection projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть проект' }))
    expect(await screen.findByText(/SSH hostname\/IP и SSH-пользователя/)).toBeInTheDocument()
    expect(screen.queryByText(/ssh -N -L/)).not.toBeInTheDocument()
  })
})
