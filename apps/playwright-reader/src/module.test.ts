import { describe, expect, it, vi } from 'vitest'
import type { BrowserRunnerClient } from '@voicechat/browser-contracts/client'
import { probeResultFixture } from '@voicechat/browser-contracts/audit/fixtures'
import type { PreviewAccessibilityResult } from '@voicechat/shared'
import type { BrowserModelTarget, PlaywrightReaderCore } from './core.js'
import { createPlaywrightReaderModule } from './module.js'

const meta = { id: 'c', conversationId: 'c', incarnation: 'inc', state: 'ready' as const, activeTabId: 't', tabs: [], viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, currentUrl: 'https://example.com/', title: 'Страница' }
const accessibilityResult = (): PreviewAccessibilityResult => ({
  page: { url: 'https://example.com/', title: 'Example' },
  accessibility: {
    version: 1, surface: 'chromium', source: 'chromium-accessibility', selector: '#target',
    node: { role: 'button', name: 'Save', ignored: false, properties: [], nameSources: [{ type: 'contents' }], ignoredReasons: [] },
    truncated: false, elapsedMs: 1, limitations: []
  }
})
function fixture(target: BrowserModelTarget | null = { sessionId: 'c', conversationKey: 'c', profileMode: 'persistent' }) {
  const core: PlaywrightReaderCore = {
    conversation: async () => ({ assistantKind: 'playwright-reader' }),
    modelTarget: vi.fn(async () => target),
    issuePreviewRunKey: vi.fn(() => 'preview-key'),
    logBrowserShot: vi.fn(async () => {})
  }
  const runner: BrowserRunnerClient = {
    start: vi.fn(async () => meta), command: vi.fn(async () => ({ ok: true, text: 'Текст из Chromium' })),
    screenshot: vi.fn(async () => ({ buffer: Buffer.from('PNG'), mimeType: 'image/png', metadata: { page: { url: 'https://example.com/captured', title: 'Снятая страница' }, rect: { x: 40, y: 900, width: 160, height: 90 }, scale: 'css' as const } })), stop: vi.fn(async () => true)
  }
  return { core, runner, service: createPlaywrightReaderModule({ core, runner, runnerFacingBase: 'http://core:8787/' }).service }
}

describe('действия модели через приложение', () => {
  it('requires strict native accessibility evidence from the runner', async () => {
    const { service, runner } = fixture()
    const action = { kind: 'accessibility' as const, selector: '#target' }
    expect(await service.execute('ann', 'c', action)).toMatchObject({ ok: false, error: expect.stringContaining('native accessibility evidence') })
    const result = { ok: true, ...accessibilityResult() }
    vi.mocked(runner.command).mockResolvedValueOnce(result)
    expect(await service.execute('ann', 'c', action)).toEqual({ ok: true, result })
    const invalid = accessibilityResult()
    ;(invalid.accessibility.node as unknown as Record<string, unknown>).value = 'secret'
    vi.mocked(runner.command).mockResolvedValueOnce({ ok: true, ...invalid })
    expect(await service.execute('ann', 'c', action)).toMatchObject({ ok: false })
  })
  it('requires a valid native probe report without falling back to the proxy', async () => {
    const { service, runner } = fixture()
    const action = { kind: 'probe' as const, selector: '#target' }
    expect(await service.execute('ann', 'c', action)).toMatchObject({ ok: false, error: expect.stringContaining('valid native control probe') })
    const result = { ok: true, ...probeResultFixture('chromium') }
    vi.mocked(runner.command).mockResolvedValueOnce(result)
    expect(await service.execute('ann', 'c', action)).toEqual({ ok: true, result })
    vi.mocked(runner.command).mockResolvedValueOnce({ ok: true, ...probeResultFixture('proxy') })
    expect(await service.execute('ann', 'c', action)).toMatchObject({ ok: false })
  })
  it('requires an explicit native audit report from the runner', async () => {
    const { service, runner } = fixture()
    expect(await service.execute('ann', 'c', { kind: 'audit' })).toMatchObject({ ok: false, error: expect.stringContaining('does not support native audits') })
    const result = { ok: true, page: { url: 'https://example.com/', title: 'Audit' }, audit: { version: 1 as const, group: 'layout', groups: ['markup', 'layout'], mode: 'list' as const, surface: 'chromium' as const, scope: 'document', findings: [], rules: [], total: 0, checkedRules: 0, scannedElements: 0, truncated: false, elapsedMs: 0, limitations: [] } }
    vi.mocked(runner.command).mockResolvedValueOnce(result)
    expect(await service.execute('ann', 'c', { kind: 'audit', group: 'layout', mode: 'list' })).toEqual({ ok: true, result })
  })
  it('диалоги маршрутизируются в авторизованную сессию и сохраняют ошибку открытого диалога', async () => {
    const { service, runner } = fixture()
    await service.control('ann', 'c', { type: 'dialogs', tabId: 't' })
    expect(runner.command).toHaveBeenLastCalledWith('c', expect.objectContaining({ incarnation: 'inc', actor: 'assistant', command: { type: 'dialogs', tabId: 't' } }))
    await service.control('ann', 'c', { type: 'handleDialog', dialogId: 'd', accept: true, promptText: '' })
    expect(runner.command).toHaveBeenLastCalledWith('c', expect.objectContaining({ command: { type: 'handleDialog', dialogId: 'd', accept: true, promptText: '' } }))
    vi.mocked(runner.command).mockRejectedValueOnce(new Error('Открыт диалог confirm (id: d)'))
    expect(await service.execute('ann', 'c', { kind: 'click', selector: '#save' })).toEqual({ ok: false, error: 'Открыт диалог confirm (id: d)' })
  })

  it('управление вкладками авторизует цель, сохраняет incarnation и прокси машины', async () => {
    const { service, runner, core } = fixture()
    await service.control('ann', 'c', { type: 'newTab', url: 'http://dev.machine.internal:5173/' })
    expect(core.modelTarget).toHaveBeenCalledWith('ann', 'c')
    expect(runner.command).toHaveBeenLastCalledWith('c', expect.objectContaining({ actor: 'assistant', incarnation: 'inc', command: { type: 'newTab', url: 'http://core:8787/api/preview?url=http%3A%2F%2Fdev.machine.internal%3A5173%2F' } }))
    await service.control('ann', 'c', { type: 'selectTab', tabId: 'popup' })
    expect(runner.command).toHaveBeenLastCalledWith('c', expect.objectContaining({ command: { type: 'selectTab', tabId: 'popup' } }))
    expect(await fixture(null).service.control('ann', 'c', { type: 'status' })).toBeNull()
    vi.mocked(runner.command).mockRejectedValueOnce(new Error('stale_tab'))
    expect(await service.control('ann', 'c', { type: 'closeTab', tabId: 'gone' })).toEqual({ ok: false, error: 'stale_tab' })
  })
  it('сохраняет id сессии, авторизует прокси машины и возвращает результат чтения модели', async () => {
    const { service, runner, core } = fixture()
    expect(await service.execute('ann', 'c', { kind: 'read' })).toEqual({ ok: true, result: { ok: true, text: 'Текст из Chromium' } })
    expect(core.modelTarget).toHaveBeenCalledWith('ann', 'c')
    expect(runner.start).toHaveBeenCalledWith({ sessionId: 'c', conversationKey: 'c', profileMode: 'persistent', userKey: 'ann', cookies: [{ name: 'vc_preview_run', value: 'preview-key', url: 'http://core:8787/api/preview' }] })
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
    expect(runner.screenshot).toHaveBeenCalledWith('task-t1', expect.objectContaining({ actor: 'assistant', incarnation: 'inc', command: { type: 'screenshot', format: 'png', scale: 'css', selector: '#form' } }))
    expect(core.logBrowserShot).toHaveBeenCalledWith('ann', 'c', Buffer.from('PNG').toString('base64'))
    expect(outcome).toMatchObject({ ok: true, result: { dataUrl: 'data:image/png;base64,UE5H', page: { title: 'Снятая страница' }, rect: { x: 40, y: 900, width: 160, height: 90 } } })
  })

  it('передаёт параметры снимка и не выдумывает область для старого раннера', async () => {
    const { service, runner } = fixture()
    vi.mocked(runner.screenshot).mockResolvedValueOnce({ buffer: Buffer.from('PNG'), mimeType: 'image/png' })
    const result = await service.screenshot('ann', 'c', { fullPage: true, animations: 'disabled', timeoutMs: 500 })
    expect(runner.screenshot).toHaveBeenCalledWith('c', expect.objectContaining({ command: { type: 'screenshot', format: 'png', scale: 'css', fullPage: true, animations: 'disabled', timeoutMs: 500 } }))
    expect(result?.result).not.toHaveProperty('rect')
    expect(result?.result).not.toHaveProperty('page')
  })
})
