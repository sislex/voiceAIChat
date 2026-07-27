// Процесс-глобальный реестр ходов LLM. Ход привязан к разговору, а не к
// WS-соединению: обновление страницы/обрыв сети его НЕ отменяет — модель
// доигрывает ответ, сервер сам сохраняет его в БД. События хода рассылаются
// всем подключённым клиентам; при (пере)подключении клиент получает снапшот
// активных ходов с накопленным частичным текстом (claude.active).

import { existsSync } from 'node:fs'
import {
  appendImageHint,
  appendQuestionsHint,
  appendToolHint,
  buildConversationPrompt,
  buildPrompt,
  clampModelForRole,
  claudeModelAlias,
  normalizeClaudeModel,
  type ActiveTurn,
  type AgentPolicy,
  type ClaudeInitInfo,
  type ClaudeLogEntry,
  type Message,
  type ServerMessage,
  type SttSegmentWire,
  type TurnMeta,
  type TurnRequestInfo
} from '@voicechat/shared'
import type { VoiceChatDb } from './db/database.js'
import { relocateImagesToMachine } from './imageRelocate.js'
import type { LlmClient, LlmHandle } from './claude/types.js'
import type { KnowledgeBaseService } from './kb/types.js'

export interface TurnManagerDeps {
  db: VoiceChatDb
  claude: LlmClient
  /** Альтернативный движок Codex (используется при settings.llmProvider='codex'). */
  codex?: LlmClient
  /** Поиск компактного контекста проекта перед ходом. */
  kb?: KnowledgeBaseService
  /** Резолв id вложения → абсолютный путь на сервере (для промпта Claude). */
  resolveUpload?: (id: string) => string | undefined
  /** Онлайн-статус и политика машин-агентов (для проброса Bash на клиента). */
  agents?: {
    isOnline(id: string): boolean
    nameOf(id: string): string | undefined
    policyOf(id: string): AgentPolicy | undefined
    /** Файловые операции машины — нужны, чтобы переложить туда картинки хода. */
    fsList?(id: string, path: string): Promise<{ root: string }>
    fsMkdir?(id: string, path: string): Promise<unknown>
    fsWrite?(id: string, path: string, dataBase64: string): Promise<unknown>
  }
  /** Корни «своей» области сервера — откуда можно забирать файл картинки. */
  serverFileRoots?: (userId: string) => string[]
  /** База URL MCP-эндпоинта remote-bash (с секретом k); undefined — проброс выключен. */
  mcpBaseUrl?: string
  /** Источник времени (для детерминированных тестов). */
  now?: () => number
}

/** Запрос нового хода (соответствует клиентскому claude.send). */
export interface StartTurnRequest {
  /** Владелец разговора (логин пользователя) — для изоляции данных. */
  userId: string
  conversationId: string
  segments: SttSegmentWire[]
  attachments?: string[]
  verbose?: boolean
  /** Цель конкретного сообщения: id, null — сервер, 'none' — запрет команд. */
  execTarget?: string | null
}

export interface TurnManager {
  /** Запустить ход в разговоре (прежний ход этого разговора отменяется). */
  start(req: StartTurnRequest): Promise<void>
  /** Отменить ход разговора; без conversationId — все активные ходы. */
  cancel(conversationId?: string): void
  /**
   * Подписка на события ходов (token/done/error/log). Слушатель получает id
   * владельца хода — сессия форвардит клиенту только события своего пользователя.
   */
  subscribe(listener: (m: ServerMessage, ownerUserId: string) => void): () => void
  /** Снапшот активных ходов пользователя (для claude.active при подключении). */
  active(userId: string): ActiveTurn[]
  /**
   * Остановка сервера (деплой/SIGTERM): отменить активные ходы и сохранить их
   * накопленный частичный текст в БД с пометкой interrupted — иначе рестарт
   * теряет уже набранную часть ответа.
   */
  flushInterrupted(): void
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
function policySummary(p: AgentPolicy, selectedSkills?: string[]): string {
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
  const skills = selectedSkills === undefined
    ? p.skills
    : p.skills.filter((skill) => selectedSkills.includes(skill.name))
  if (skills.length) {
    parts.push(`Навыки этого разговора: ${skills.map((s) => `«${s.name}» → ${s.command}${s.description ? ` (${s.description})` : ''}`).join('; ')}.`)
  } else if (selectedSkills !== undefined) {
    parts.push('Для этого разговора навыки не выбраны.')
  }
  return `Политика машины: ${parts.join(' ')}`
}

interface TurnState {
  handle: LlmHandle
  partial: string
  verbose: boolean
  /** Владелец хода (для фильтрации broadcast/active по пользователю). */
  userId: string
  /** Активность хода (для подробного вида сообщения); собирается всегда. */
  activity: ClaudeLogEntry[]
  /** Ход завершён (done/error/flush) — поздние события CLI игнорируются. */
  done: boolean
  /** Контекст хода — чтобы flushInterrupted мог сохранить прерванный ответ. */
  provider: 'claude' | 'codex'
  model: string
  startedAt: number
  requestInfo: TurnRequestInfo
  execTarget: string | null
}

/** Кэп на число записей активности, хранимых у одного хода. */
const ACTIVITY_CAP = 500

export function createTurnManager(deps: TurnManagerDeps): TurnManager {
  const listeners = new Set<(m: ServerMessage, ownerUserId: string) => void>()
  const turns = new Map<string, TurnState>()
  const now = deps.now ?? (() => Date.now())

  function broadcast(m: ServerMessage, ownerUserId: string): void {
    for (const l of listeners) l(m, ownerUserId)
  }

  /** Время сообщения в формате ленты (HH:MM), как у клиента. */
  function timeHHMM(): string {
    const d = new Date(now())
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  async function start(req: StartTurnRequest): Promise<void> {
    const conversationId = req.conversationId
    const userId = req.userId
    // Заблокированный пользователь не может запускать ходы (страховка сверх WS-гейта).
    const account = deps.db.getUser(userId)
    if (!account || account.blocked) {
      broadcast({ t: 'claude.error', conversationId, message: 'Учётная запись недоступна.' }, userId)
      return
    }
    // Новый ход в том же разговоре отменяет прежний (повторная отправка).
    cancelTurn(conversationId, false)

    const conv = deps.db.getConversation(userId, conversationId)
    const settings = deps.db.getSettings(userId)
    // Движок и модель: переопределение разговора приоритетнее общих настроек
    // (conv.llmProvider=null — наследуем). Модель Claude клампим по роли
    // пользователя (у роли user нет opus/fable — сервер не даст обойти фильтр).
    const wantProvider = conv?.llmProvider ?? settings.llmProvider
    const provider = wantProvider === 'codex' && deps.codex ? 'codex' : 'claude'
    const client = provider === 'codex' ? deps.codex! : deps.claude
    const role = account.role
    const convModel = conv?.llmProvider === provider ? conv.llmModel : null
    const model =
      provider === 'codex'
        ? (convModel ?? settings.codexModel)
        : claudeModelAlias(
            clampModelForRole(convModel ? normalizeClaudeModel(convModel) : settings.model, role)
          )
    // session-id хранится с префиксом провайдера ("claude:…"/"codex:…"); при
    // смене движка чужой resume-id игнорируем (свежий ход).
    const sessionId = resumeIdFor(conv?.claudeSessionId ?? null, provider)
    // Режим прав: переопределение разговора приоритетнее общих настроек.
    let permissionMode = conv?.permissionMode ?? settings.permissionMode
    // Рабочий каталог разговора (`conv.workdir`) выбирается через проводник
    // МАШИНЫ — это путь на её хосте, и в контейнере сервера его нет. Он уходит
    // только в MCP-мост (`&cwd=`), где `remote.bash` делает `cd` на агенте.
    // Локальный `cwd` для процесса claude берём исключительно из серверных
    // настроек и только если каталог реально существует здесь.
    const localCwd = settings.workdir && existsSync(settings.workdir) ? settings.workdir : undefined
    const attachmentPaths = (req.attachments ?? [])
      .map((id) => deps.resolveUpload?.(id))
      .filter((p): p is string => typeof p === 'string')
    // Есть сессия → продолжаем одним ходом (--resume). Нет (новый разговор или
    // сессия сброшена после удаления/правки) → пересобираем промпт из текущей
    // истории БД, чтобы контекст модели совпадал с видимым (без удалённых реплик).
    // Хинт о формате уточняющих вопросов (```questions) — форма ответов в чате;
    // ```image — созданная картинка показывается прямо в сообщении.
    let kbContext: TurnRequestInfo['kbContext']
    let basePrompt = sessionId
      ? buildPrompt(req.segments, attachmentPaths)
      : buildConversationPrompt(deps.db.listMessages(userId, conversationId), attachmentPaths)
    if (deps.kb && (conv?.kbContextMode ?? 'auto') === 'auto') {
      const kbQuery = req.segments.map((segment) => segment.text).join(' ').trim()
      if (kbQuery) {
        try {
          const bundle = await deps.kb.context(kbQuery, 3500)
          if (bundle.autoInjectAllowed && bundle.sections.length) {
            kbContext = { confidence: bundle.confidence, sections: bundle.sections.map(({ documentId, title, heading, sourcePath, anchor }) => ({ documentId, title, heading, sourcePath, anchor })) }
            const sections = bundle.sections.map((section) => `### ${section.title} / ${section.heading}\nИсточник: ${section.sourcePath}${section.anchor ? `#${section.anchor}` : ''}\n${section.excerpt}`).join('\n\n')
            basePrompt = `${basePrompt}\n\n## Контекст базы знаний voiceAIChat\nИспользуй как навигацию и сверяй с кодом при изменении поведения.\n\n${sections}`
          }
        } catch {
          // KB не должна блокировать основной ход: exact/BM25/reranker могут быть временно недоступны.
        }
      }
    }
    // Контекст проекта, к которому привязан чат (git/технологии/навыки/описание).
    if (conv?.projectId) {
      const project = deps.db.getProject(userId, conv.projectId)
      if (project) {
        const lines = [
          project.gitUrl ? `Git-репозиторий: ${project.gitUrl}` : '',
          project.technologies.length ? `Технологии: ${project.technologies.join(', ')}` : '',
          project.skills.length ? `Навыки/области: ${project.skills.join(', ')}` : '',
          project.description ? project.description : ''
        ].filter(Boolean)
        if (lines.length) basePrompt = `${basePrompt}\n\n## Контекст проекта «${project.name}»\n${lines.join('\n')}`
      }
    }
    const prompt = appendImageHint(appendToolHint(appendQuestionsHint(basePrompt)))
    // Цель выполнения команд: выбранная машина-агент. Только своя машина
    // (чужую игнорируем → выполняем на сервере). Офлайн своей — сразу ошибка.
    const requestedTarget =
      req.execTarget === undefined ? (conv ? conv.execTarget : settings.execTarget) : req.execTarget
    const executionDisabled = requestedTarget === 'none'
    const target =
      !executionDisabled && requestedTarget && deps.db.listAgents(userId).some((a) => a.id === requestedTarget)
        ? requestedTarget
        : null
    let remote: { mcpUrl: string; agentName: string; policySummary?: string } | undefined
    if (target && deps.agents && deps.mcpBaseUrl) {
      if (!deps.agents.isOnline(target)) {
        broadcast(
          {
            t: 'claude.error',
            conversationId,
            message: `Машина «${deps.agents.nameOf(target) ?? target}» не в сети. Запустите на ней агента или выберите «На сервере» в настройках.`
          },
          userId
        )
        return
      }
      const policy = deps.agents.policyOf(target)
      remote = {
        mcpUrl: `${deps.mcpBaseUrl}&agent=${encodeURIComponent(target)}${conv?.workdir ? `&cwd=${encodeURIComponent(conv.workdir)}` : ''}`,
        agentName: deps.agents.nameOf(target) ?? target,
        policySummary: policy ? policySummary(policy, conv?.skillNames ?? []) : undefined
      }
    }
    // Никогда не подставляем сюда каталог машины: chdir в несуществующий (или
    // чужой, вроде /root) путь роняет спавн с ENOENT/EACCES ещё до запуска CLI.
    const cwd = localCwd
    // Роль user не имеет прав что-либо делать на сервере: без своей машины ход
    // идёт «на сервере» → форсим режим «план» (только текст/план, без изменений и
    // выполнения). На своей машине действия регулирует политика машины.
    if (executionDisabled || (role === 'user' && !remote)) permissionMode = 'plan'
    // Полный контекст хода: все сообщения разговора на момент отправки
    // (реплика пользователя уже сохранена клиентом перед claude.send).
    const contextMessages = deps.db
      .listMessages(userId, conversationId)
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
      ...(executionDisabled ? { execTarget: 'Без машины (команды запрещены)' } : remote ? { execTarget: remote.agentName } : {}),
      ...(contextMessages.length ? { messages: contextMessages } : {}),
      ...(kbContext ? { kbContext } : {})
    }
    // Окружение хода из system/init (инструменты/навыки/mcp) — только claude.
    let initInfo: ClaudeInitInfo | undefined
    const startedAt = now()
    const turn: TurnState = {
      handle: { cancel: () => {} },
      partial: '',
      verbose: Boolean(req.verbose),
      userId,
      activity: [],
      done: false,
      provider,
      model,
      startedAt,
      requestInfo,
      execTarget: requestedTarget
    }
    turns.set(conversationId, turn)
    const finish = (): void => {
      turn.done = true
      if (turns.get(conversationId) === turn) turns.delete(conversationId)
    }
    turn.handle = client.send(
      { userId, prompt, sessionId, model, permissionMode, cwd, remote, executionDisabled },
      {
        onSession: (sid) => deps.db.setClaudeSession(userId, conversationId, `${provider}:${sid}`),
        onInit: (info) => {
          initInfo = info
        },
        onDelta: (delta) => {
          if (turn.done) return
          turn.partial += delta
          broadcast({ t: 'claude.token', conversationId, delta }, userId)
        },
        onDone: (text, meta) => {
          if (turn.done) return
          finish()
          // Итоговая модель: из потока CLI → из настроек → у Codex с пустой
          // настройкой модель берётся из его config.toml и наружу не видна.
          const resolvedModel =
            meta?.model || model || (provider === 'codex' ? 'по умолчанию (Codex)' : model)
          // Смещения `at` считались относительно turn.partial. Если CLI вернул
          // финальный текст, отличный от накопленного (край: часть Codex), —
          // чередование невалидно, снимаем `at` (fallback к «действия над текстом»).
          // Перекладка картинок меняет длину только в хвосте ответа (после всех
          // действий), поэтому более ранние смещения не съезжают.
          const canInterleave = !text.trim() || text === turn.partial
          const activity = canInterleave
            ? turn.activity
            : turn.activity.map(({ at: _at, ...e }) => e)
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
            },
            // Активность хода — для подробного вида сообщения (персистится в meta).
            ...(activity.length ? { activity } : {})
          }
          // Ответ сохраняет сервер: клиент мог обновить страницу или уйти.
          const rawText = text.trim() ? text : turn.partial

          // Картинки, созданные CLI, лежат на сервере — перекладываем их на
          // машину разговора, откуда браузер возьмёт их напрямую. Шаг сетевой,
          // поэтому сохранение и claude.done ждут его; осечка не критична —
          // relocate вернёт исходный текст, и картинка покажется через сервер.
          const prepared = (async (): Promise<string> => {
            const a = deps.agents
            if (!target || !a?.fsList || !a.fsMkdir || !a.fsWrite || !deps.serverFileRoots) {
              return rawText
            }
            try {
              return await relocateImagesToMachine(rawText, target, {
                roots: deps.serverFileRoots(userId),
                fsList: (id, path) => a.fsList!(id, path),
                fsMkdir: (id, path) => a.fsMkdir!(id, path),
                fsWrite: (id, path, data) => a.fsWrite!(id, path, data)
              })
            } catch {
              return rawText
            }
          })()

          void prepared.then((finalText) => {
            let message: Message | undefined
            if (finalText.trim()) {
              message = deps.db.addMessage(
                userId,
                conversationId,
                'ai',
                finalText,
                timeHHMM(),
                provider,
                merged,
                requestedTarget
              )
            }
            broadcast(
              {
                t: 'claude.done',
                conversationId,
                text: finalText,
                meta: merged,
                engine: provider,
                ...(message ? { message } : {})
              },
              userId
            )
          })
        },
        onError: (message) => {
          if (turn.done) return
          finish()
          broadcast({ t: 'claude.error', conversationId, message }, userId)
        },
        // Активность собираем всегда (для подробного вида сообщения); в глобальную
        // консоль (событие claude.log) шлём только если ход запрошен с verbose.
        onActivity: (entry) => {
          if (turn.done) return
          // Смещение действия в тексте = длина уже накопленного ответа. Клиент
          // применяет токены и лог в том же порядке, поэтому по `at` UI чередует
          // действия с абзацами (и в живом потоке, и в сохранённом сообщении).
          const stamped: ClaudeLogEntry = { ...entry, at: turn.partial.length }
          turn.activity.push(stamped)
          if (turn.activity.length > ACTIVITY_CAP) turn.activity.shift()
          if (req.verbose) broadcast({ t: 'claude.log', conversationId, entry: stamped }, userId)
        }
      }
    )
    // Мгновенно завершившийся ход (мок/ошибка спавна) уже убран из реестра.
    if (turn.done) turn.handle = { cancel: () => {} }
  }

  /** Отмена одного хода; notify — рассылать ли пустой done (сброс UI вкладок). */
  function cancelTurn(conversationId: string, notify: boolean): void {
    const turn = turns.get(conversationId)
    if (!turn) return
    turns.delete(conversationId)
    turn.handle.cancel()
    // Пустой done без message: клиенты сбрасывают «думает…», в БД ничего нет.
    if (notify) broadcast({ t: 'claude.done', conversationId, text: '' }, turn.userId)
  }

  function cancel(conversationId?: string): void {
    if (conversationId) cancelTurn(conversationId, true)
    else for (const id of [...turns.keys()]) cancelTurn(id, true)
  }

  /**
   * Плановая остановка сервера: каждый активный ход отменяется, а накопленный
   * частичный текст сохраняется в БД как ответ с пометкой interrupted (вместе с
   * активностью) — после рестарта пользователь видит уже набранную часть.
   */
  function flushInterrupted(): void {
    for (const [conversationId, turn] of [...turns]) {
      turns.delete(conversationId)
      turn.done = true
      turn.handle.cancel()
      if (!turn.partial.trim()) continue
      const meta: TurnMeta = {
        durationMs: now() - turn.startedAt,
        model: turn.model,
        interrupted: true,
        request: turn.requestInfo,
        ...(turn.activity.length ? { activity: turn.activity } : {})
      }
      const message = deps.db.addMessage(
        turn.userId,
        conversationId,
        'ai',
        turn.partial,
        timeHHMM(),
        turn.provider,
        meta,
        turn.execTarget
      )
      broadcast(
        { t: 'claude.done', conversationId, text: turn.partial, meta, engine: turn.provider, message },
        turn.userId
      )
    }
  }

  return {
    start,
    cancel,
    flushInterrupted,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    active(userId) {
      return [...turns]
        .filter(([, t]) => t.userId === userId)
        .map(([conversationId, t]) => ({
          conversationId,
          partial: t.partial,
          ...(t.activity.length ? { activity: t.activity } : {})
        }))
    }
  }
}
