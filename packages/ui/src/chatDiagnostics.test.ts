import { describe, expect, it } from 'vitest'
import { CHAT_DIAGNOSTICS_CAPABILITIES, isChatDiagnosticsCommand, runChatDiagnostics, type ChatDiagnosticsProbes } from './chatDiagnostics'

function makeProbes(over: Partial<ChatDiagnosticsProbes> = {}): ChatDiagnosticsProbes {
  return {
    engine: () => 'claude',
    ping: async () => ({ ok: true, version: '0.1.200', releasedAt: '', commit: null, task: null }),
    wsConnected: () => true,
    sessionMe: async () => ({ name: 'admin', role: 'admin' }),
    capabilities: async () => ({ stt: { available: true, reason: '' }, tts: { available: true, reason: '' }, memoryLimitBytes: 2e9, cpuCount: 2 }),
    authStatus: async () => ({ claude: { provider: 'claude', loggedIn: true }, codex: { provider: 'codex', loggedIn: false } }),
    mcpList: async () => [{ name: 'kb', detail: '', status: '', connected: true }],
    modelRoundtrip: async () => 'ответ модели',
    createConversation: async () => 'diag-conv-1',
    echoMessage: async () => true,
    deleteConversation: async () => {},
    storeSnapshot: () => ({ conversations: 3, activeId: 'conv-active' }),
    ...over
  }
}

describe('chat diagnostics', () => {
  it('распознаёт только две команды запуска', () => {
    expect(isChatDiagnosticsCommand('  Самодиагностика чата  ')).toBe(true)
    expect(isChatDiagnosticsCommand('/chat-diagnostics')).toBe(true)
    expect(isChatDiagnosticsCommand('самодиагностика')).toBe(false)
    expect(isChatDiagnosticsCommand('самодиагностика web reader')).toBe(false)
  })

  it('публикует перечень и проходит все проверки на исправном стенде', async () => {
    const published: string[] = []
    const probes = makeProbes()
    const results = await runChatDiagnostics({
      probes, signal: new AbortController().signal, publish: async (text) => { published.push(text) }
    })
    expect(published[0]).toContain(CHAT_DIAGNOSTICS_CAPABILITIES[0])
    expect(results).toHaveLength(11)
    expect(results.every((step) => step.ok && step.durationMs >= 0)).toBe(true)
    expect(published[published.length - 1]).toContain('11/11 проверок успешно')
    // Эфемерный разговор удалён ровно один раз (внутри шага, не в finally повторно).
    expect(results.find((s) => s.id === 'db-delete')?.ok).toBe(true)
  })

  it('падение входа CLI активного движка помечает слой backend и останавливает прогон', async () => {
    const published: string[] = []
    const probes = makeProbes({ authStatus: async () => ({ claude: { provider: 'claude', loggedIn: false, detail: 'выполните claude login' }, codex: { provider: 'codex', loggedIn: false } }) })
    const results = await runChatDiagnostics({ probes, signal: new AbortController().signal, publish: async (text) => { published.push(text) } })
    const failed = results.find((s) => !s.ok)
    expect(failed?.id).toBe('auth-cli')
    expect(failed?.layer).toBe('backend')
    expect(published.some((t) => t.includes('Проблемный слой: backend'))).toBe(true)
    // После падения шаги модели и БД не выполняются.
    expect(results.some((s) => s.id === 'model')).toBe(false)
  })

  it('удаляет эфемерный разговор даже при обрыве после создания (finally)', async () => {
    const deleted: string[] = []
    const probes = makeProbes({
      createConversation: async () => 'ephemeral-42',
      echoMessage: async () => { throw new Error('БД недоступна') },
      deleteConversation: async (id) => { deleted.push(id) }
    })
    const results = await runChatDiagnostics({ probes, signal: new AbortController().signal, publish: async () => {} })
    expect(results.find((s) => s.id === 'db-echo')?.ok).toBe(false)
    expect(deleted).toEqual(['ephemeral-42'])
  })

  it('прерывание сигналом не публикует финал с ошибкой', async () => {
    const controller = new AbortController()
    const published: string[] = []
    const probes = makeProbes({ ping: async () => { controller.abort(); return { ok: true, version: null, releasedAt: '', commit: null, task: null } } })
    await runChatDiagnostics({ probes, signal: controller.signal, publish: async (text) => { published.push(text) } })
    expect(published.some((t) => t.includes('завершена с ошибкой'))).toBe(false)
    expect(published.some((t) => t.includes('проверок успешно'))).toBe(false)
  })

  it('WS закрыт → падение на слое transport', async () => {
    const results = await runChatDiagnostics({ probes: makeProbes({ wsConnected: () => false }), signal: new AbortController().signal, publish: async () => {} })
    const failed = results.find((s) => !s.ok)
    expect(failed?.id).toBe('ws')
    expect(failed?.layer).toBe('transport')
  })
})
