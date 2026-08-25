import type { HealthResponse, SystemCapabilities } from '@shared/protocol'
import type { McpServer } from '@shared/mcp'
import type { LoginStatusMap } from '@shared/auth'
import type { LlmProvider, SessionUser } from '@shared/types'

// Самодиагностика чата — сквозная проверка «клиент → сервер → модель → БД» из
// самого чата, по образцу webReaderDiagnostics: команда в композере публикует
// перечень проверок и пошаговый результат служебными AI-сообщениями (без запуска
// LLM для публикации). Модуль чистый: DOM/сети не трогает, всё внешнее приходит
// пробами — поэтому тестируется моками, как и Reader-версия.

export function isChatDiagnosticsCommand(value: string): boolean {
  const command = value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
  return command === '/chat-diagnostics' || command === 'самодиагностика чата'
}

export type ChatDiagnosticsLayer = 'transport' | 'backend' | 'model' | 'persistence' | 'store'
export interface ChatDiagnosticsStep {
  id: string
  label: string
  layer: ChatDiagnosticsLayer
  durationMs: number
  ok: boolean
  message: string
}

export const CHAT_DIAGNOSTICS_CAPABILITIES = [
  'HTTP до сервера (/api/health) и версия релиза',
  'WebSocket-соединение открыто',
  'сессия пользователя',
  'возможности сервера (CPU/RAM, STT/TTS)',
  'вход CLI активного движка (claude/codex)',
  'MCP-серверы хода модели',
  'реальный ход модели (Claude/haiku round-trip)',
  'создание разговора в БД',
  'запись и чтение сообщения',
  'удаление разговора',
  'целостность стора чата'
] as const

const redact = (value: string): string =>
  value.replace(/(cookie|authorization|token|password|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]').slice(0, 500)

/** Пробы внешнего мира: вызывающий (App) замыкает доступ к мостам `window.*` и стору. */
export interface ChatDiagnosticsProbes {
  /** Активный движок разговора (для проверки нужного входа CLI). */
  engine(): LlmProvider
  ping(): Promise<HealthResponse>
  wsConnected(): boolean
  sessionMe(): Promise<SessionUser | null>
  capabilities(): Promise<SystemCapabilities>
  authStatus(): Promise<LoginStatusMap>
  mcpList(): Promise<McpServer[]>
  /** Реальный лёгкий вызов модели; возвращает произведённый текст (пусто — провал). */
  modelRoundtrip(): Promise<string>
  /** Создаёт эфемерный разговор и возвращает его id. */
  createConversation(): Promise<string>
  /** Пишет сообщение с маркером и читает разговор назад; true — маркер на месте. */
  echoMessage(conversationId: string, marker: string): Promise<boolean>
  deleteConversation(conversationId: string): Promise<void>
  storeSnapshot(): { conversations: number; activeId: string | null }
}

export interface ChatDiagnosticsOptions {
  probes: ChatDiagnosticsProbes
  signal: AbortSignal
  publish: (text: string) => Promise<void>
}

export async function runChatDiagnostics(options: ChatDiagnosticsOptions): Promise<ChatDiagnosticsStep[]> {
  const { probes } = options
  await options.publish('Самодиагностика чата — перечень проверок:\n' + CHAT_DIAGNOSTICS_CAPABILITIES.map((item) => '• ' + item).join('\n'))
  const results: ChatDiagnosticsStep[] = []
  const step = async (id: string, label: string, layer: ChatDiagnosticsLayer, operation: () => Promise<string>): Promise<void> => {
    if (options.signal.aborted) throw new DOMException('Диагностика отменена.', 'AbortError')
    const started = performance.now()
    try {
      const note = await operation()
      if (options.signal.aborted) throw new DOMException('Диагностика отменена.', 'AbortError')
      const durationMs = Math.round(performance.now() - started)
      results.push({ id, label, layer, durationMs, ok: true, message: note || 'OK' })
      await options.publish(`✓ ${label} — ${durationMs} мс — ${note || 'OK'}`)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') throw reason
      const message = redact(reason instanceof Error ? reason.message : String(reason))
      const durationMs = Math.round(performance.now() - started)
      results.push({ id, label, layer, durationMs, ok: false, message })
      await options.publish(`✗ ${label} — ${durationMs} мс — слой ${layer}: ${message}`)
      throw reason
    }
  }

  // Разговор для проверки БД создаётся внутри прогона; удаляем в finally,
  // чтобы эфемерная беседа не осталась в сайдбаре даже при обрыве.
  let ephemeralId: string | null = null
  try {
    await step('health', 'HTTP до сервера', 'transport', async () => {
      const health = await probes.ping()
      if (health?.ok !== true) throw new Error('сервер не подтвердил готовность')
      return health.version ? `версия ${health.version}` : 'OK'
    })
    await step('ws', 'WebSocket-соединение', 'transport', async () => {
      if (!probes.wsConnected()) throw new Error('сокет закрыт — переподключение не завершено')
      return 'открыт'
    })
    await step('session', 'сессия пользователя', 'transport', async () => {
      const user = await probes.sessionMe()
      return user ? `вход: ${user.name || user.role}` : 'без входа (desktop)'
    })
    await step('capabilities', 'возможности сервера', 'backend', async () => {
      const caps = await probes.capabilities()
      const bits = [caps.stt.available ? 'STT' : null, caps.tts.available ? 'TTS' : null].filter(Boolean)
      return bits.length ? bits.join(', ') + ' доступны' : 'STT/TTS выключены (памяти мало)'
    })
    await step('auth-cli', 'вход CLI активного движка', 'backend', async () => {
      const engine = probes.engine()
      const status = await probes.authStatus()
      const entry = status[engine]
      if (!entry?.loggedIn) throw new Error(`${engine}: ${entry?.detail ?? 'вход не подтверждён'}`)
      return `${engine}: вход подтверждён`
    })
    await step('mcp', 'MCP-серверы', 'backend', async () => {
      const servers = await probes.mcpList()
      const connected = servers.filter((s) => s.connected).length
      if (servers.length > 0 && connected === 0) throw new Error('ни один MCP-сервер не подключён')
      return servers.length ? `${connected}/${servers.length} подключено` : 'MCP-серверы не настроены'
    })
    await step('model', 'реальный ход модели', 'model', async () => {
      const text = await probes.modelRoundtrip()
      if (!text.trim()) throw new Error('модель вернула пустой ответ')
      return 'модель ответила'
    })
    await step('db-create', 'создание разговора в БД', 'persistence', async () => {
      ephemeralId = await probes.createConversation()
      if (!ephemeralId) throw new Error('сервер не вернул id разговора')
      return 'создан'
    })
    await step('db-echo', 'запись и чтение сообщения', 'persistence', async () => {
      const marker = `diag-${Math.round(performance.now())}`
      const echoed = await probes.echoMessage(ephemeralId as string, marker)
      if (!echoed) throw new Error('записанное сообщение не прочиталось назад')
      return 'сообщение сохранено и прочитано'
    })
    await step('db-delete', 'удаление разговора', 'persistence', async () => {
      await probes.deleteConversation(ephemeralId as string)
      ephemeralId = null
      return 'удалён'
    })
    await step('store', 'целостность стора чата', 'store', async () => {
      const snapshot = probes.storeSnapshot()
      if (!snapshot.activeId) throw new Error('активный разговор не выбран в сторе')
      return `${snapshot.conversations} разговоров в сторе`
    })
    await options.publish(`Самодиагностика чата завершена: ${results.length}/${results.length} проверок успешно.`)
  } catch (reason) {
    if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
      await options.publish(`Самодиагностика чата завершена с ошибкой. Проблемный слой: ${results.find((item) => !item.ok)?.layer ?? 'transport'}.`)
    }
  } finally {
    // Подчищаем эфемерный разговор, если прогон оборвался между созданием и удалением.
    if (ephemeralId) { try { await probes.deleteConversation(ephemeralId) } catch { /* уже нет — не мешаем */ } }
  }
  return results
}
