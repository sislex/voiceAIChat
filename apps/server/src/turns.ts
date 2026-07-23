// Процесс-глобальный реестр ходов LLM. Ход привязан к разговору, а не к
// WS-соединению: обновление страницы/обрыв сети его НЕ отменяет — модель
// доигрывает ответ, сервер сам сохраняет его в БД. События хода рассылаются
// всем подключённым клиентам; при (пере)подключении клиент получает снапшот
// активных ходов с накопленным частичным текстом (claude.active).

import { existsSync } from 'node:fs'
import {
  appendQuestionsHint,
  buildConversationPrompt,
  buildPrompt,
  claudeModelAlias,
  type ActiveTurn,
  type AgentPolicy,
  type ClaudeInitInfo,
  type Message,
  type ServerMessage,
  type SttSegmentWire,
  type TurnMeta,
  type TurnRequestInfo
} from '@voicechat/shared'
import type { VoiceChatDb } from './db/database.js'
import type { LlmClient, LlmHandle } from './claude/types.js'

export interface TurnManagerDeps {
  db: VoiceChatDb
  claude: LlmClient
  /** Альтернативный движок Codex (используется при settings.llmProvider='codex'). */
  codex?: LlmClient
  /** Резолв id вложения → абсолютный путь на сервере (для промпта Claude). */
  resolveUpload?: (id: string) => string | undefined
  /** Онлайн-статус и политика машин-агентов (для проброса Bash на клиента). */
  agents?: {
    isOnline(id: string): boolean
    nameOf(id: string): string | undefined
    policyOf(id: string): AgentPolicy | undefined
  }
  /** База URL MCP-эндпоинта remote-bash (с секретом k); undefined — проброс выключен. */
  mcpBaseUrl?: string
  /** Источник времени (для детерминированных тестов). */
  now?: () => number
}

/** Запрос нового хода (соответствует клиентскому claude.send). */
export interface StartTurnRequest {
  conversationId: string
  segments: SttSegmentWire[]
  attachments?: string[]
  verbose?: boolean
}

export interface TurnManager {
  /** Запустить ход в разговоре (прежний ход этого разговора отменяется). */
  start(req: StartTurnRequest): void
  /** Отменить ход разговора; без conversationId — все активные ходы. */
  cancel(conversationId?: string): void
  /** Подписка на события ходов (token/done/error/log). Возвращает отписку. */
  subscribe(listener: (m: ServerMessage) => void): () => void
  /** Снапшот активных ходов (для claude.active при подключении). */
  active(): ActiveTurn[]
}

/**
 * Разбирает сохранённый resume-id с префиксом провайдера ("claude:abc"/"codex:xyz").
 * Возвращает id только если он принадлежит текущему провайдеру; иначе null
 * (смена движка → свежий ход без чужого resume). Терпит старые id без префикса
 * (считаем их claude).
 */
function resumeIdFor(stored: string | null, provider: 'claude' | 'codex'): string | null {
  if (!stored) return null
  const m = /^(claude|codex):(.*)$/s.exec(stored)
  if (!m) return provider === 'claude' ? stored : null
  return m[1] === provider ? m[2] : null
}

/** Краткое описание политики машины для системного промпта Claude. */
function policySummary(p: AgentPolicy): string {
  const parts: string[] = []
  if (p.allowedDirs.length) parts.push(`Работай только в каталогах: ${p.allowedDirs.join(', ')}.`)
  parts.push(
    p.allowNetwork
      ? 'Доступ в сеть разрешён.'
      : 'Доступ в сеть запрещён — не используй curl/wget/ssh и подобное.'
  )
  parts.push(
    p.allowWrite ? 'Изменение файлов разрешено.' : 'Изменение файлов запрещено — только чтение.'
  )
  if (p.denyPatterns.length) parts.push(`Запрещённые паттерны команд: ${p.denyPatterns.join(', ')}.`)
  if (p.allowPatterns.length) parts.push(`Разрешены только команды: ${p.allowPatterns.join(', ')}.`)
  if (p.skills.length) {
    parts.push(`Доступные скрипты: ${p.skills.map((s) => `«${s.name}» → ${s.command}`).join('; ')}.`)
  }
  return `Политика машины: ${parts.join(' ')}`
}

interface TurnState {
  handle: LlmHandle
  partial: string
  verbose: boolean
}

export function createTurnManager(deps: TurnManagerDeps): TurnManager {
  const listeners = new Set<(m: ServerMessage) => void>()
  const turns = new Map<string, TurnState>()
  const now = deps.now ?? (() => Date.now())

  function broadcast(m: ServerMessage): void {
    for (const l of listeners) l(m)
  }

  /** Время сообщения в формате ленты (HH:MM), как у клиента. */
  function timeHHMM(): string {
    const d = new Date(now())
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  function start(req: StartTurnRequest): void {
    const conversationId = req.conversationId
    // Новый ход в том же разговоре отменяет прежний (повторная отправка).
    cancelTurn(conversationId, false)

    const conv = deps.db.getConversation(conversationId)
    const settings = deps.db.getSettings()
    // Движок и модель по провайдеру.
    const provider = settings.llmProvider === 'codex' && deps.codex ? 'codex' : 'claude'
    const client = provider === 'codex' ? deps.codex! : deps.claude
    const model = provider === 'codex' ? settings.codexModel : claudeModelAlias(settings.model)
    // session-id хранится с префиксом провайдера ("claude:…"/"codex:…"); при
    // смене движка чужой resume-id игнорируем (свежий ход).
    const sessionId = resumeIdFor(conv?.claudeSessionId ?? null, provider)
    const permissionMode = settings.permissionMode
    // Рабочий каталог — только если задан и существует (иначе игнор).
    const cwd = settings.workdir && existsSync(settings.workdir) ? settings.workdir : undefined
    const attachmentPaths = (req.attachments ?? [])
      .map((id) => deps.resolveUpload?.(id))
      .filter((p): p is string => typeof p === 'string')
    // Есть сессия → продолжаем одним ходом (--resume). Нет (новый разговор или
    // сессия сброшена после удаления/правки) → пересобираем промпт из текущей
    // истории БД, чтобы контекст модели совпадал с видимым (без удалённых реплик).
    // Хинт о формате уточняющих вопросов (```questions) — форма ответов в чате.
    const prompt = appendQuestionsHint(
      sessionId
        ? buildPrompt(req.segments, attachmentPaths)
        : buildConversationPrompt(deps.db.listMessages(conversationId), attachmentPaths)
    )
    // Цель выполнения команд: выбранная машина-агент. Офлайн — сразу ошибка:
    // молча выполнить команды не на той машине хуже, чем отказать.
    const target = settings.execTarget
    let remote: { mcpUrl: string; agentName: string; policySummary?: string } | undefined
    if (target && deps.agents && deps.mcpBaseUrl) {
      if (!deps.agents.isOnline(target)) {
        broadcast({
          t: 'claude.error',
          conversationId,
          message: `Машина «${deps.agents.nameOf(target) ?? target}» не в сети. Запустите на ней агента или выберите «На сервере» в настройках.`
        })
        return
      }
      const policy = deps.agents.policyOf(target)
      remote = {
        mcpUrl: `${deps.mcpBaseUrl}&agent=${encodeURIComponent(target)}`,
        agentName: deps.agents.nameOf(target) ?? target,
        policySummary: policy ? policySummary(policy) : undefined
      }
    }
    // Полный контекст хода: все сообщения разговора на момент отправки
    // (реплика пользователя уже сохранена клиентом перед claude.send).
    const contextMessages = deps.db
      .listMessages(conversationId)
      .map((m) => ({ role: m.role, text: m.text }))
    // Детали запроса для панели «Подробнее» (всё, что мы отправили модели).
    const requestInfo: TurnRequestInfo = {
      provider,
      model,
      prompt,
      promptChars: prompt.length,
      resumed: Boolean(sessionId),
      ...(permissionMode ? { permissionMode } : {}),
      ...(cwd ? { cwd } : {}),
      ...(attachmentPaths.length ? { attachments: attachmentPaths } : {}),
      ...(remote ? { execTarget: remote.agentName } : {}),
      ...(contextMessages.length ? { messages: contextMessages } : {})
    }
    // Окружение хода из system/init (инструменты/навыки/mcp) — только claude.
    let initInfo: ClaudeInitInfo | undefined
    const startedAt = now()
    let finished = false
    const turn: TurnState = { handle: { cancel: () => {} }, partial: '', verbose: Boolean(req.verbose) }
    turns.set(conversationId, turn)
    const finish = (): void => {
      finished = true
      if (turns.get(conversationId) === turn) turns.delete(conversationId)
    }
    turn.handle = client.send(
      { prompt, sessionId, model, permissionMode, cwd, remote },
      {
        onSession: (sid) => deps.db.setClaudeSession(conversationId, `${provider}:${sid}`),
        onInit: (info) => {
          initInfo = info
        },
        onDelta: (delta) => {
          if (finished) return
          turn.partial += delta
          broadcast({ t: 'claude.token', conversationId, delta })
        },
        onDone: (text, meta) => {
          if (finished) return
          finish()
          // Итоговая модель: из потока CLI → из настроек → у Codex с пустой
          // настройкой модель берётся из его config.toml и наружу не видна.
          const resolvedModel =
            meta?.model || model || (provider === 'codex' ? 'по умолчанию (Codex)' : model)
          const merged: TurnMeta = {
            ...meta,
            // Длительность из CLI, а если её нет — измеряем по стенным часам.
            durationMs: meta?.durationMs ?? now() - startedAt,
            model: resolvedModel,
            request: {
              ...requestInfo,
              model: resolvedModel,
              ...(initInfo?.tools ? { tools: initInfo.tools } : {}),
              ...(initInfo?.slashCommands ? { slashCommands: initInfo.slashCommands } : {}),
              ...(initInfo?.mcpServers ? { mcpServers: initInfo.mcpServers } : {})
            }
          }
          // Ответ сохраняет сервер: клиент мог обновить страницу или уйти.
          const finalText = text.trim() ? text : turn.partial
          let message: Message | undefined
          if (finalText.trim()) {
            message = deps.db.addMessage(conversationId, 'ai', finalText, timeHHMM(), provider, merged)
          }
          broadcast({
            t: 'claude.done',
            conversationId,
            text: finalText,
            meta: merged,
            engine: provider,
            ...(message ? { message } : {})
          })
        },
        onError: (message) => {
          if (finished) return
          finish()
          broadcast({ t: 'claude.error', conversationId, message })
        },
        // Режим консоли: активность агента шлём только если ход запрошен с verbose.
        onActivity: req.verbose
          ? (entry) => broadcast({ t: 'claude.log', conversationId, entry })
          : undefined
      }
    )
    // Мгновенно завершившийся ход (мок/ошибка спавна) уже убран из реестра.
    if (finished) turn.handle = { cancel: () => {} }
  }

  /** Отмена одного хода; notify — рассылать ли пустой done (сброс UI вкладок). */
  function cancelTurn(conversationId: string, notify: boolean): void {
    const turn = turns.get(conversationId)
    if (!turn) return
    turns.delete(conversationId)
    turn.handle.cancel()
    // Пустой done без message: клиенты сбрасывают «думает…», в БД ничего нет.
    if (notify) broadcast({ t: 'claude.done', conversationId, text: '' })
  }

  function cancel(conversationId?: string): void {
    if (conversationId) cancelTurn(conversationId, true)
    else for (const id of [...turns.keys()]) cancelTurn(id, true)
  }

  return {
    start,
    cancel,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    active() {
      return [...turns].map(([conversationId, t]) => ({ conversationId, partial: t.partial }))
    }
  }
}
