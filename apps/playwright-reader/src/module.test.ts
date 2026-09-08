import { describe, expect, it, vi } from 'vitest'
import type { BrowserRunnerClient } from '@voicechat/browser-runner/client'
import type { PlaywrightReaderCore } from './core.js'
import { createPlaywrightReaderModule } from './module.js'

const meta = { id: 'c', conversationId: 'c', incarnation: 'inc', state: 'ready' as const, activeTabId: 't', tabs: [], viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, currentUrl: 'https://example.com/', title: 'Страница' }
function fixture(target: { sessionId: string; conversationKey: string } | null = { sessionId: 'c', conversationKey: 'c' }) {
  const core: PlaywrightReaderCore = {
    conversation: async () => ({ assistantKind: 'playwright-reader' }),
    modelTarget: vi.fn(async () => target),
    issuePreviewRunKey: vi.fn(() => 'preview-key'),
    logBrowserShot: vi.fn(async () => {})
  }
  const runner: BrowserRunnerClient = {
    start: vi.fn(async () => meta), command: vi.fn(async () => ({ ok: true, text: 'Текст из Chromium' })),
    screenshot: vi.fn(async () => ({ buffer: Buffer.from('PNG'), mimeType: 'image/png' })), stop: vi.fn(async () => true)
  }
  return { core, runner, service: createPlaywrightReaderModule({ core, runner, runnerFacingBase: 'http://core:8787/' }).service }
}

describe('действия модели через приложение', () => {
  it('сохраняет id сессии, авторизует прокси машины и возвращает результат чтения модели', async () => {
    const { service, runner, core } = fixture()
    expect(await service.execute('ann', 'c', { kind: 'read' })).toEqual({ ok: true, result: { ok: true, text: 'Текст из Chromium' } })
    expect(core.modelTarget).toHaveBeenCalledWith('ann', 'c')
    expect(runner.start).toHaveBeenCalledWith({ sessionId: 'c', conversationKey: 'c', userKey: 'ann', cookies: [{ name: 'vc_preview_run', value: 'preview-key', url: 'http://core:8787/api/preview' }] })
    await service.execute('ann', 'c', { kind: 'open', url: 'http://dev.machine.internal:5173/' })
    expect(runner.command).toHaveBeenLastCalledWith('c', expect.objectContaining({ incarnation: 'inc', actor: 'assistant', command: { type: 'navigate', url: 'http://core:8787/api/preview?url=http%3A%2F%2Fdev.machine.internal%3A5173%2F' } }))
  })

  it('обычную панель оставляет relay, без раннера в Chromium-разговоре возвращает явный отказ', async () => {
    const panel = fixture(null)
    expect(await panel.service.execute('ann', 'c', { kind: 'read' })).toBeNull()
    expect(await panel.service.screenshot('ann', 'c', {})).toBeNull()
    expect(panel.runner.start).not.toHaveBeenCalled()
    const { core } = fixture()
    const disabled = createPlaywrightReaderModule({ core, runnerFacingBase: 'http://core' }).service
    expect(await disabled.execute('ann', 'c', { kind: 'read' })).toMatchObject({ ok: false, error: expect.stringContaining('не настроен') })
    expect(await disabled.screenshot('ann', 'c', {})).toMatchObject({ ok: false })
  })

  it('ошибка селектора и недоступность раннера не выдаются за успех', async () => {
    const { service, runner } = fixture()
    vi.mocked(runner.command).mockResolvedValueOnce({ ok: false, error: 'Элемент не найден' })
    expect(await service.execute('ann', 'c', { kind: 'read' })).toEqual({ ok: false, error: 'Элемент не найден' })
    vi.mocked(runner.start).mockRejectedValueOnce(new Error('runner offline'))
    expect(await service.execute('ann', 'c', { kind: 'read' })).toEqual({ ok: false, error: 'runner offline' })
  })

  it('снимок проверки использует профиль задачи и возвращает PNG вместе с записью кадра у ядра', async () => {
    const { service, runner, core } = fixture({ sessionId: 'task-t1', conversationKey: 'task-t1' })
    const outcome = await service.screenshot('ann', 'c', { selector: '#form' })
    expect(runner.screenshot).toHaveBeenCalledWith('task-t1', expect.objectContaining({ actor: 'assistant', incarnation: 'inc', command: { type: 'screenshot', format: 'png', selector: '#form' } }))
    expect(core.logBrowserShot).toHaveBeenCalledWith('ann', 'c', Buffer.from('PNG').toString('base64'))
    expect(outcome).toMatchObject({ ok: true, result: { dataUrl: 'data:image/png;base64,UE5H', page: { title: 'Страница' } } })
  })
})
