// REST-роуты поверх VoiceChatDb (Ф3): разговоры, сообщения, настройки.

import { join } from 'node:path'
import { ageFromBirth, agentsChainDirs, approxTokens, buildContextBlocks, promptCostUsd, personalizationLabels, personalizationPromptBlock, projectContextBlock, promptBlock, taskContextBlock } from '../prompt/contextBlocks.js'
import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  REST,
  CONVERSATION_STATUSES,
  type ConversationStatus,
  ccResumeMessages,
  ccResumeTitle,
  ccTimeLabel,
  cxResumeMessages,
  cxResumeTitle,
  cxTimeLabel,
  type AddMessageArgs,
  type DesktopMigrationBundle,
  type Settings,
  type UsageUnit,
  type UserProfileInfo,
  type SecurityEvent,
  type AgentInfo,
  buildConversationPrompt,
  effectiveChatInstructions,
  instructionsForAssistantKind,
  designPromptLines,
  taskMakeSources,
  makeDesignPreviewUrl,
  instructionContextId,
  instructionText,
  resumeSessionIdFor,
  contextLockReason,
  isContextToggleable,
  toolNameForContextId,
  sanitizeSettingsPatch,
  claudeModelAlias,
  kbToolHint,
  previewToolHint,
  MAKE_ASSISTANT_HINT,
  KANBAN_ASSISTANT_HINT,
  firstAllowedProvider,
  isProviderAllowed,
  CLAUDE_MODELS,
  CODEX_MODELS
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import { readUserFile } from '../serverFiles.js'
import { ensureCliProfile, listMcpServers } from '@voicechat/llm-runner/cli'
import { getLoginStatus } from '../auth/loginStatus.js'
import type { RunnerFsClient } from '../llm/runnerFsClient.js'
import type { AgentsChainFile, AgentsChainResult, ContextDiff, KbStatus, ContextKbPreview, ContextLastTurn, ContextTurnSize, ContextWarning, ConversationContextSnapshot, ContextSnapshotGroup, ContextSnapshotItem, KbContextMode, LlmProvider, PermissionMode } from '@voicechat/shared'
import { buildKbAutoContext } from '../kb/autoContext.js'
import { kbViewOf } from '../kb/access.js'
import { MAKE_ONLY_DISALLOWED_TOOLS } from '../turns.js'
import type { KnowledgeBaseService } from '../kb/types.js'

/**
 * Порог замечания о размере постоянной части промпта (в приблизительных
 * токенах). Взят с запасом: обычный набор инструкций чата даёт ~600, поэтому
 * 4000 — это уже «кто-то дописал слишком много», а не штатная работа.
 */
const CONTEXT_PREVIEW_TOKENS_NOTICE = 4000
/**
 * Во сколько раз постоянная часть должна превысить средний размер прошлых
 * ходов, чтобы это стоило назвать ростом. Полтора — рост, который человек уже
 * замечает по счёту и по «модель забыла начало»; меньше — обычные колебания
 * от длины сообщения.
 */
const CONTEXT_GROWTH_RATIO_NOTICE = 1.5
/**
 * С какого размера историю стоит называть главным потребителем контекста.
 * Ниже тысячи токенов совет «начните новый разговор» бессмыслен: там ещё
 * ничего не мешает.
 */
const CONTEXT_HISTORY_TOKENS_NOTICE = 1000
/** Меньше трёх ходов — среднее не среднее, а случайная величина. */
const CONTEXT_GROWTH_MIN_TURNS = 3

const permissionDisplay: Record<PermissionMode, { displayName: string; explanation: string }> = {
  plan: { displayName: 'Только планирование', explanation: 'Изменение данных отключено.' },
  acceptEdits: { displayName: 'Авто-правки файлов', explanation: 'Правки разрешены в пределах политики машины.' },
  bypassPermissions: { displayName: 'Полный доступ', explanation: 'Действия ограничены системными правилами и политикой машины.' }
}
const kbDisplay: Record<KbContextMode, { displayName: string; explanation: string }> = {
  auto: { displayName: 'Автоматически', explanation: 'Документы выбираются по отправляемому сообщению; поиск также доступен.' },
  manual: { displayName: 'По запросу', explanation: 'Автоматической вставки нет, инструменты поиска доступны.' },
  off: { displayName: 'Отключено', explanation: 'Автоматический контекст и инструменты БЗ не подключаются.' }
}
/**
 * Снимок контекста разговора. `userId` — владелец, чьим scope читаются данные;
 * `viewer` — кто смотрит. Они различаются, когда админ открывает чужой чат:
 * данные берутся у владельца (иначе снимок был бы пустым), но роль и пометка
 * «чужой разговор» считаются по смотрящему.
 */
/**
 * Необязательные входы снимка. Раньше это были пять позиционных аргументов
 * подряд, и на вызове было не понять, что означает шестой; новый вход (текст
 * Make-контекста) сделал бы это окончательно нечитаемым.
 */
interface ContextSnapshotOptions {
  isOnline?: (id: string) => boolean
  kbStatus?: KbStatus | null
  cliMcpServers?: Array<{ name: string; detail: string; status: string }>
  /** Кто смотрит: у админа это может быть не владелец разговора. */
  viewer?: string
  /** Текст контекста Make-проекта, если чат Make: читается вне снимка (async). */
  makeContext?: string | null
}

function contextSnapshot(db: VoiceChatDb, userId: string, conversationId: string, options: ContextSnapshotOptions = {}): ConversationContextSnapshot | null {
  const { isOnline, kbStatus, cliMcpServers = [], viewer = userId, makeContext = null } = options
  const conversation = db.getConversation(userId, conversationId)
  if (!conversation) return null
  // Тумблеры: пункт можно выключить (кроме безопасности/информации); выключенный
  // не считается включённым в следующий ход (includedInNextTurn=false).
  const disabled = new Set(conversation.disabledContext ?? [])
  /**
   * Что делает тумблер этого пункта. Считается по id — там же, где живёт само
   * правило выключения: инструменты уходят в `--disallowedTools`, навыки не
   * передаются исполнителю, остальное убирает блок промпта.
   */
  const effectOf = (id: string): 'prompt-block' | 'tool' | 'skill' => {
    if (toolNameForContextId(id) !== null) return 'tool'
    if (id.startsWith('skill-')) return 'skill'
    // База знаний статического блока не даёт: автоконтекст зависит от текста
    // сообщения, а выключение гасит инструменты mcp__kb__*. Объявлять здесь
    // «блок промпта» значило бы проверять инвариантом не то, что происходит.
    if (id === 'knowledge-mode') return 'tool'
    return 'prompt-block'
  }
  const contextItem = (value: Omit<ContextSnapshotItem, 'toggleable' | 'enabled' | 'lockReason' | 'effect'>): ContextSnapshotItem => {
    const toggleable = isContextToggleable(value.id)
    const enabled = toggleable ? !disabled.has(value.id) : true
    // Причина замка приходит с сервера словом, а не выводится в UI по id:
    // правила гейтинга живут в одном месте (`contextGating.ts`).
    const lockReason = toggleable ? null : contextLockReason(value.id)
    return { ...value, toggleable, enabled, lockReason, effect: toggleable ? effectOf(value.id) : null, includedInNextTurn: value.includedInNextTurn && enabled }
  }
  const settings = db.getSettings(userId)
  // Роль — у смотрящего: админ, открывший чужой чат, видит его как админ.
  const role = db.getUser(viewer)?.role ?? 'developer'
  // Make-чат к машине не подключается (`turns.ts`: makeChat), поэтому снимок не
  // показывает ни её, ни remote-инструменты как доступные: иначе панель обещала
  // бы Bash на машине, которого ход не даёт.
  const makeChat = conversation.assistantKind === 'make'
  const resolution = makeChat ? null : db.resolveConversationMachine(userId, conversationId, { isOnline })
  const agent = resolution?.agentId ? db.listUsableAgents(userId, conversation.projectId).find((a) => a.id === resolution.agentId) : undefined
  const machineAvailable = Boolean(resolution?.agentId && !resolution.error)
  const project = conversation.projectId ? db.getProject(userId, conversation.projectId) : null
  const projectLlm = project && conversation.llmProvider === null
    ? db.getCiLlmConfig('project', project.id)
    : null
  /**
   * Движок — с учётом прав пользователя, как в ходе (`turns.ts`): если
   * выбранный провайдер ему не разрешён, ход молча берёт первый доступный.
   * Пока снимок показывал сохранённое значение как есть, инспектор обещал
   * codex человеку, у которого он закрыт, — а отвечал claude.
   */
  const wantedProvider = conversation.llmProvider ?? projectLlm?.provider ?? settings.llmProvider
  const llmAccess = db.getUserLlmAccess(userId)
  const fallbackProvider = firstAllowedProvider(llmAccess)
  const provider: LlmProvider = isProviderAllowed(llmAccess, wantedProvider) || !fallbackProvider ? wantedProvider : fallbackProvider
  const selectedModel = conversation.llmProvider === provider
    ? conversation.llmModel
    : (projectLlm && projectLlm.provider === provider ? projectLlm.model : null)
  /**
   * Движок-исполнитель — по правилам хода (`turns.ts`): закреплённый в
   * разговоре/проекте движок, недоступный роли пользователя, молча заменяется
   * дефолтным. Пока снимок об этом молчал, «какой раннер исполнит ход» было
   * видно только по факту исполнения.
   */
  const wantedEngineId = conversation.llmEngineId ?? projectLlm?.llmEngineId ?? settings.llmEngineId ?? null
  const engineResolution = db.resolveLlmEngine(wantedEngineId, provider, role)
  // Модель Claude приводится к алиасу меню тем же `claudeModelAlias`, что и в
  // ходе: сохранённое старое значение («opus») исполнитель резолвит в «opus[1m]»,
  // и показывать сырое значение значит называть не ту модель.
  const rawModel = selectedModel ?? (provider === 'codex' ? settings.codexModel : settings.model)
  const model = provider === 'claude' && rawModel ? claudeModelAlias(rawModel) : rawModel
  const llmSource = conversation.llmProvider ? 'Разговор' : projectLlm ? 'Проект' : 'Настройки пользователя'
  const llmExplanation = conversation.llmProvider
    ? 'Явное переопределение.'
    : projectLlm
      ? 'Унаследовано из настроек проекта.'
      : 'Унаследовано из настроек пользователя.'
  /**
   * Режим доступа — по правилам хода (`turns.ts`), включая исключение для Make.
   * Там ход НЕ понижает режим до «плана» без машины: инструменты `make_*`
   * машины не требуют, а нативный plan-режим CLI их глушит. Вместо понижения
   * запрещаются встроенные инструменты (`MAKE_ONLY_DISALLOWED_TOOLS`) — при
   * любой роли, включая админа. Пока снимок этого не знал, обычный пользователь
   * в Make-чате видел «Только планирование», а ход шёл с правкой файлов проекта.
   */
  const makeOnlyExecution = makeChat && provider === 'claude'
    && (conversation.permissionMode ?? settings.permissionMode) !== 'plan'
  const permissionMode: PermissionMode = conversation.execTarget === 'none' || (makeChat && provider === 'codex')
    || (role !== 'admin' && !machineAvailable && !makeOnlyExecution)
    ? 'plan'
    : (conversation.permissionMode ?? settings.permissionMode)
  // Тумблер сильнее настройки — ровно как в ходе (`turns.ts`: kbMode). Пока
  // снимок считал режим только по разговору, выключенная тумблером база знаний
  // показывалась работающей: пункты `mcp-kb-*` оставались «доступны», хотя ход
  // их не подключает.
  const kbMode: KbContextMode = disabled.has('knowledge-mode') ? 'off' : (conversation.kbContextMode ?? 'auto')
  const projectMachine = project?.machines.find((entry) => entry.agentId === resolution?.agentId)
  const workdir = conversation.workdir ?? projectMachine?.path ?? settings.workdir
  const messages = db.listMessages(userId, conversationId)
  // Тот же разбор resume-id, что и у хода модели (`turns.ts`), и тот же билдер
  // истории: иначе размер в панели не совпадёт с отправленным.
  const resumeId = resumeSessionIdFor(conversation.claudeSessionId ?? null, provider)
  const historyText = buildConversationPrompt(messages)
  // Контекст задачи — тот же блок, что уходит в ход: раньше предпросмотр про
  // него не знал, и в чате задачи инспектор обещал заметно меньше, чем уходило.
  const linkedTask = conversation.taskId && conversation.projectId ? db.getCiTask(userId, conversation.projectId, conversation.taskId) : null
  const makeSources = taskMakeSources(linkedTask?.designs ?? [])
  /** Связи макета задачи: по ним ход подключает read-only Make-источники. */
  const taskDesigns = conversation.taskId && conversation.projectId
    ? (db.getCiTask(userId, conversation.projectId, conversation.taskId)?.designs ?? [])
    : []
  const taskContext = (() => {
    if (!conversation.taskId || disabled.has('project-binding') || disabled.has('task-context')) return null
    const tc = db.getTaskChatContext(userId, conversationId, isOnline)
    if (!tc) return null
    return taskContextBlock({
      context: tc,
      description: linkedTask?.description ?? null,
      acceptanceCriteria: linkedTask?.acceptanceCriteria ?? null,
      designLines: linkedTask?.designs?.length ? designPromptLines(linkedTask.designs, makeDesignPreviewUrl) : []
    })
  })()

  const selectedSkills = new Set(conversation.skillNames)

  // Полная детализация для drill-in: те же данные и тот же текст, что реально
  // уходят в промпт (см. turns.ts) — чтобы «провалиться» и увидеть всё.
  const p = settings.personalization
  const now = new Date()
  const labels = personalizationLabels(p)
  const personalizationText = personalizationPromptBlock(p, now)
  const personalizationDetails: Record<string, string | number | boolean | string[] | null> = {
    'Обращение': p.preferredName || '—',
    'Язык ответа': p.responseLanguage || '—',
    'Стиль': labels.style,
    'Тон': labels.tone,
    'Возраст в промпте': ageFromBirth(p, now) === null ? '—' : `${ageFromBirth(p, now)} лет`,
    'Текст в промпте': personalizationText ?? '(персонализация пуста — в промпт ничего не добавляется)'
  }
  // Тот же билдер, что у хода модели: иначе панель показывает не то, что ушло.
  // Сводка персонализации для карточки: перечисляем заданное, а не поле подряд.
  const personalizationSummary = [
    p.preferredName ? `обращение «${p.preferredName}»` : '',
    p.responseLanguage ? `язык ${p.responseLanguage}` : '',
    p.responseStyle !== 'normal' ? `стиль ${labels.style}` : '',
    p.tone !== 'neutral' ? `тон ${labels.tone}` : '',
    ageFromBirth(p, now) === null ? '' : 'учитывается возраст'
  ].filter(Boolean).join(', ') || 'Предпочтения не заданы — в промпт ничего не добавляется.'

  const projectText = projectContextBlock(project, conversation.projectId ?? null)
  const projectDetails: Record<string, string | number | boolean | string[] | null> = project
    ? {
        'ID проекта': project.id,
        'Git': project.gitUrl || '—',
        'Технологии': project.technologies.join(', ') || '—',
        'Навыки/области': project.skills.join(', ') || '—',
        'Описание': project.description || '—',
        'Тип проекта': project.typeChain?.label || '—',
        'Текст в промпте': projectText ?? '—'
      }
    : { 'Проект': 'Не выбран — проектный контекст в промпт не добавляется.' }
  // Конфиг/описание каждого MCP-инструмента для drill-in.
  /**
   * Инструменты вида чата: их подключает `turns.ts` по `assistantKind`, а не
   * настройки разговора. Условия здесь повторяют условия хода — если там
   * появится новое семейство, оно обязано появиться и тут, иначе список «что
   * сможет модель» снова станет неполным.
   */
  const autonomy = conversation.assistantAutonomy ?? 'auto'
  const kindTools = [
    {
      id: 'mcp-browser-preview', title: 'browser:* (веб-превью)', source: 'Вид чата: превью страницы', readOnlyInPlan: false,
      scope: 'Браузер пользователя', tools: ['mcp__browser__*'],
      description: 'Клики, ввод и чтение страницы в браузере пользователя.',
      available: conversation.assistantKind !== 'make',
      whenAvailable: 'Подключается в чатах с превью: действия выполняет браузер пользователя, машина-агент для них не нужна.',
      whenUnavailable: 'В Make-чате браузерные инструменты не подключаются: панель — iframe проекта, и модель упиралась в таймауты.'
    },
    {
      id: 'mcp-console-pty', title: 'console:* (живой терминал)', source: 'Вид чата: консоль с ассистентом', readOnlyInPlan: true,
      scope: 'PTY-сессия чата', tools: ['mcp__console__*'],
      description: 'Пишет команды в открытую справа PTY-сессию.',
      available: conversation.assistantKind === 'console-reader',
      whenAvailable: 'Подключается в «Консоли с ассистентом»: терминал уже открыт, модель работает прямо в нём.',
      whenUnavailable: 'Появится только в чате «Консоль с ассистентом».'
    },
    {
      id: 'mcp-make-files', title: 'make:* (файлы проекта)', source: 'Вид чата: Make', readOnlyInPlan: true,
      scope: 'Проект Make этого чата', tools: ['mcp__make__*'],
      description: 'Читает и пишет файлы проекта Make.',
      available: conversation.assistantKind === 'make',
      whenAvailable: 'Подключается в Make-чате: правка файлов проекта и есть задача такого чата.',
      whenUnavailable: 'Появится только в чате Make.'
    },
    {
      // Read-only источники макета в чате задачи (turns.ts: buildTaskMakeSources
      // по task_designs связанной задачи). Появились отдельно от Make-чата:
      // модель читает файлы макета, не будучи Make-ассистентом.
      id: 'mcp-make-design', title: 'make_design:* (макет задачи, только чтение)', source: 'Привязка задачи к макету Make', readOnlyInPlan: false,
      scope: taskDesigns.length ? `${taskDesigns.length} связь(и) с Make` : 'Задача без макета', tools: ['mcp__make_design_*__make_list_files', 'mcp__make_design_*__make_read_file'],
      description: 'Чтение файлов Make-проекта, привязанного к задаче этого чата.',
      available: taskDesigns.length > 0,
      whenAvailable: 'Подключается в чате задачи с привязанным макетом: инструменты только читают файлы, записи нет ни в каком режиме.',
      whenUnavailable: conversation.taskId ? 'У задачи этого чата нет привязанного Make-макета.' : 'Появится в чате задачи с привязанным Make-макетом.'
    },
    {
      id: 'mcp-kanban-board', title: 'kanban:* (доска проекта)', source: 'Панель ассистента проекта', readOnlyInPlan: true,
      scope: project?.name ?? 'Проект чата', tools: ['mcp__kanban__*'],
      description: 'Читает доску, задачи и открытый экран пользователя.',
      available: Boolean(conversation.projectId),
      whenAvailable: 'Подключается, когда сообщение отправлено из панели ассистента проекта: обычный ход чата их не получает.',
      whenUnavailable: 'Чат не привязан к проекту — доски у него нет.'
    }
  ]

  const mcpToolDetails: Record<string, Record<string, string | number | boolean | string[] | null>> = {
    'mcp-remote-machines': { 'Инструмент': 'mcp__remote__machines', 'Назначение': 'Список машин проекта и их онлайн-статус.', 'Параметры': ['machine'], 'Изменяет данные': false },
    'mcp-remote-read': { 'Инструмент': 'mcp__remote__read', 'Назначение': 'Читает окно строк файла в рабочей директории машины.', 'Параметры': ['path', 'offset', 'limit', 'machine'], 'Изменяет данные': false },
    'mcp-remote-edit': { 'Инструмент': 'mcp__remote__edit', 'Назначение': 'Точная замена текста в файле на машине.', 'Параметры': ['path', 'oldString', 'newString', 'machine'], 'Изменяет данные': true, 'Ограничение': 'Режим прав и политика машины.' },
    'mcp-remote-bash': { 'Инструмент': 'mcp__remote__bash', 'Назначение': 'Выполняет shell-команду в рабочем каталоге машины.', 'Параметры': ['command', 'timeout_ms', 'machine'], 'Изменяет данные': true, 'Ограничение': 'Потенциально опасно; политика машины и режим прав.' },
    'mcp-kb-search': { 'Инструмент': 'mcp__kb__search', 'Назначение': 'Поиск по доступным разделам базы знаний.', 'Параметры': ['query', 'limit'], 'Изменяет данные': false, 'Ограничение': 'Результаты фильтруются по пользователю и проекту.' },
    'mcp-kb-document': { 'Инструмент': 'mcp__kb__document', 'Назначение': 'Чтение раздела БЗ по устойчивому id.', 'Параметры': ['documentId', 'anchor'], 'Изменяет данные': false },
    'mcp-kb-topics': { 'Инструмент': 'mcp__kb__topics', 'Назначение': 'Список тем/разделов базы знаний.', 'Параметры': [], 'Изменяет данные': false }
  }
  const groups: ContextSnapshotGroup[] = [
    { id: 'instructions', order: 1, title: 'Системные и прикладные инструкции', description: 'Закрытые тексты представлены безопасными метаданными.', items: [
      contextItem({ id: 'platform-instructions', type: 'Системная инструкция', source: 'Платформа', scope: 'Все ходы', priority: '1 · системный', title: 'Правила платформы', description: 'Безопасность, конфиденциальность и границы действий.', explanation: 'Применяются всегда; полный текст закрыт.', configured: true, available: true, includedInNextTurn: true }),
      contextItem({ id: 'application-instructions', type: 'Инструкция приложения', source: 'VoiceChat', scope: 'Текущий разговор', priority: '2 · приложение', title: 'Правила VoiceChat', description: 'Маршрутизация инструментов, машин и БЗ.', explanation: 'Сервер добавляет их к каждому ходу.', configured: true, available: true, includedInNextTurn: true }),
      // Описание — человеческая сводка, а не сырое значение поля: раньше здесь
      // стояло `responseLanguage || responseStyle`, и в карточке было просто «normal».
      contextItem({ id: 'personalization', type: 'Персонализация', source: 'Настройки пользователя', scope: 'Ответы пользователю', priority: '3 · пользователь', title: 'Предпочтения ответа', description: personalizationSummary, explanation: 'Учитываются при сборке прикладных инструкций.', configured: Object.values(settings.personalization).some(Boolean), available: true, includedInNextTurn: Object.values(settings.personalization).some(Boolean), details: personalizationDetails })
    ] },
    { id: 'chat-instructions', order: 2, title: 'Инструкции чата', description: 'Подсказки из «Настройки → Инструкции»; здесь их можно выключить только для этого разговора.', items: settings.chatInstructions.map((item) => contextItem({
      id: instructionContextId(item.id), type: item.kind ? 'Встроенная инструкция' : 'Своя инструкция', source: 'Настройки пользователя', scope: 'Каждый ход', priority: '3 · инструкция чата',
      title: item.title, description: item.description || (item.kind ? 'Стандартная подсказка.' : 'Текст пользователя.'),
      explanation: item.enabled ? 'Включена в настройках; тумблер справа выключает её только в этом разговоре.' : 'Выключена в настройках пользователя — в ход не попадает независимо от тумблера.',
      configured: item.enabled, available: true, includedInNextTurn: item.enabled,
      details: {
        'Вид': item.kind ?? 'своя',
        // Где выключено: в общих настройках (тогда её нет во всех чатах) или
        // тумблером этого разговора. Раньше оба случая выглядели одинаково.
        'Где выключена': item.enabled ? (disabled.has(instructionContextId(item.id)) ? 'только в этом разговоре' : '—') : 'в общих настройках (во всех чатах)',
        'Порядок в промпте': `${settings.chatInstructions.indexOf(item) + 1} из ${settings.chatInstructions.length}`,
        'Символов в тексте': instructionText(item).length,
        'Текст': instructionText(item)
      }
    })) },
    { id: 'project', order: 3, title: 'Проект, директория и AGENTS.md', description: 'Эффективная рабочая область следующего хода.', items: [
      contextItem({ id: 'project-binding', type: 'Проект', source: 'Настройки разговора', scope: project?.name ?? 'Без проекта', priority: '4 · проект', title: project?.name ?? 'Проект не выбран', description: project ? 'Проект доступен пользователю.' : 'Привязка отсутствует.', explanation: project ? 'Явная привязка разговора.' : 'Проектный контекст не включён.', configured: Boolean(conversation.projectId), available: Boolean(project), includedInNextTurn: Boolean(project), details: projectDetails }),
      // Контекст Make-проекта: токены темы и открытые комментарии. Уходит в
      // каждом ходе Make-чата и до этого в предпросмотре отсутствовал.
      ...(conversation.assistantKind === 'make' ? [contextItem({ id: 'make-context', type: 'Make', source: 'Мастерская проекта', scope: 'Следующий ход', priority: '4 · проект Make',
        title: 'Контекст проекта Make',
        description: makeContext ? 'Токены темы и открытые комментарии к макету' : 'Пока пусто: нет токенов темы и открытых комментариев',
        explanation: 'Собирается из файлов проекта Make в момент хода. Выключается тумблером — тогда модель работает без темы и замечаний.',
        configured: true, available: Boolean(makeContext), includedInNextTurn: Boolean(makeContext) && !disabled.has('make-context'),
        size: makeContext ? { chars: makeContext.length, approxTokens: approxTokens(makeContext.length) } : null })] : []),
      // Контекст задачи — отдельный пункт: в чате задачи это самый большой блок
      // после истории, а до этого он прятался внутри «проекта» и в предпросмотр
      // не попадал вовсе.
      contextItem({ id: 'task-context', type: 'Задача', source: 'Карточка задачи', scope: conversation.taskId ?? 'Не привязан', priority: '4 · задача',
        title: 'Контекст задачи',
        description: conversation.taskId ? 'Иерархия, этап, описание и критерии приёмки' : 'Чат не привязан к задаче',
        explanation: conversation.taskId
          ? 'Уходит в каждом ходе чата задачи. Выключается отдельно от проекта: постановка бывает длинной, а привязка к проекту нужна и без неё.'
          : 'Появится, если чат создан из карточки задачи.',
        configured: Boolean(conversation.taskId), available: Boolean(conversation.taskId), includedInNextTurn: Boolean(taskContext),
        details: makeSources.length ? {
          'Make-источники': makeSources.map((source) => `${source.name}: ${source.title} (${source.conversationId}) — ${source.paths.includes('') ? 'проект целиком' : source.paths.join(', ')}`)
        } : undefined }),
      contextItem({ id: 'working-directory', type: 'Рабочая директория', source: conversation.workdir ? 'Разговор' : projectMachine ? 'Проект' : 'Настройки пользователя', scope: workdir ?? 'Не задана', priority: '5 · рабочая область', title: 'Рабочая директория', description: workdir ?? 'Каталог не настроен.', explanation: workdir && machineAvailable ? 'Передаётся исполнителю как cwd.' : 'Каталог нельзя проверить без доступной машины.', configured: Boolean(workdir), available: Boolean(workdir && machineAvailable), includedInNextTurn: Boolean(workdir) }),
      contextItem({ id: 'agents-chain', type: 'AGENTS.md', source: 'Рабочая директория', scope: workdir ?? 'Не определена', priority: '6 · от общей к конкретной', title: 'Цепочка AGENTS.md', description: workdir ? 'Фактическую цепочку разрешает исполнитель в рабочей директории.' : 'Без директории цепочка не определяется.', explanation: workdir && machineAvailable ? 'Текст скрыт: снимок не раскрывает файл без отдельного подтверждённого чтения.' : 'Директория или машина недоступна.', configured: Boolean(workdir), available: Boolean(workdir && machineAvailable), includedInNextTurn: Boolean(workdir && machineAvailable), details: { hiddenReason: 'Содержимое не читалось сервером инспектора.' } })
    ] },
    { id: 'conversation', order: 4, title: 'Настройки разговора', description: 'Эффективные значения с учётом наследования.', items: [
      contextItem({ id: 'llm', type: 'Настройка разговора', source: llmSource, scope: 'Следующий ход', priority: '7 · конфигурация', title: 'Модель и провайдер', description: `${provider} · ${model || 'модель из конфигурации CLI'}`, explanation: llmExplanation, configured: true, available: true, includedInNextTurn: true, inheritance: {
        effective: `${provider} · ${model || 'модель из конфигурации CLI'}`,
        // «Источник» отвечает откуда взято; наследование — что переопределено и
        // чем было бы без переопределения. Без второго не понять, что даст сброс.
        ...(conversation.llmProvider
          ? { overriddenFrom: `${projectLlm?.provider ?? settings.llmProvider} · ${projectLlm?.model ?? ((settings.llmProvider === 'codex' ? settings.codexModel : settings.model) || 'модель из конфигурации CLI')}` }
          : { inheritedFrom: projectLlm ? 'настройки проекта' : 'общие настройки пользователя' })
      },
        details: {
          'Исполнитель': engineResolution.engine ? engineResolution.engine.name : 'встроенный запуск CLI на сервере',
          ...(engineResolution.substituted ? { 'Замена движка': 'закреплённый исполнитель недоступен вашей роли или выключен — взят доступный по умолчанию' } : {})
        } }),
      // Политика машины — часть ответа «что модель сможет сделать»: каталоги и
      // запрещённые команды ограничивают её сильнее, чем режим прав.
      contextItem({ id: 'machine', type: 'Настройка разговора', source: resolution?.source === 'explicit' ? 'Разговор' : 'Резолвер сервера', scope: agent?.name ?? resolution?.agentId ?? 'Сервер', priority: '7 · конфигурация', title: 'Машина выполнения', description: agent?.name ?? 'Доступной машины нет', explanation: resolution?.error ? `Недоступна: ${resolution.error}.` : `Источник: ${resolution?.source ?? 'none'}.`, configured: conversation.execTarget !== null, available: machineAvailable, includedInNextTurn: machineAvailable, details: agent
        ? {
            'Разрешённые каталоги': agent.policy.allowedDirs.length ? agent.policy.allowedDirs.join(', ') : 'любой каталог',
            'Запрещённые паттерны команд': agent.policy.denyPatterns.length ? agent.policy.denyPatterns.join(', ') : 'нет',
            'Разрешены только команды': agent.policy.allowPatterns.length ? agent.policy.allowPatterns.join(', ') : 'ограничений нет',
            'Правка файлов': agent.policy.allowWrite ? 'разрешена' : 'запрещена',
            'Сеть': agent.policy.allowNetwork ? 'разрешена' : 'запрещена',
            'Навыков в политике': agent.policy.skills.length
          }
        : { 'Машина': 'не выбрана или недоступна' } }),
      // Автопилот панели ассистента: решает, применяет ли модель изменения
      // доски сама или спрашивает каждое. Это не «что ей уйдёт», а «что она
      // сможет сделать», и до этого экран об этом молчал — хотя переключатель
      // живёт в шапке ассистента и о нём легко забыть.
      ...(conversation.projectId ? [contextItem({ id: 'assistant-autonomy', type: 'Панель ассистента', source: 'Настройки разговора', scope: project?.name ?? 'Проект чата', priority: '8 · права ассистента',
        title: autonomy === 'auto' ? 'Автопилот: изменения без подтверждения' : 'Автопилот выключен: каждое изменение спрашивается',
        description: autonomy === 'auto'
          ? 'Ассистент меняет доску сам; необратимое (деплой, удаление) спрашивается всегда.'
          : 'Ассистент спрашивает любое изменение доски.',
        explanation: 'Действует только для ходов из панели ассистента проекта. Обычный чат доску не меняет.',
        configured: true, available: true, includedInNextTurn: true,
        details: { 'Значение': autonomy, 'Спрашивается всегда': ['деплой', 'удаление'] } })] : []),
      contextItem({ id: 'permission-mode', type: 'Режим разрешений', source: conversation.permissionMode ? 'Разговор' : 'Эффективная политика сервера', scope: 'Инструменты и изменения', priority: '7 · конфигурация', title: permissionDisplay[permissionMode].displayName, description: permissionDisplay[permissionMode].explanation, explanation: permissionMode === 'plan' && conversation.permissionMode !== 'plan' ? 'Сервер безопасно форсировал режим.' : 'Выбранное или унаследованное значение.', configured: true, available: true, includedInNextTurn: true, inheritance: {
        effective: permissionDisplay[permissionMode].displayName,
        ...(conversation.permissionMode && conversation.permissionMode !== permissionMode
          ? { overriddenFrom: `${permissionDisplay[conversation.permissionMode].displayName} — сервер снизил режим` }
          : conversation.permissionMode ? {} : { inheritedFrom: `общие настройки: ${permissionDisplay[settings.permissionMode].displayName}` })
      }, details: { value: permissionMode } })
    ] },
    { id: 'skills', order: 5, title: 'Навыки', description: 'Выбор отделён от доступности и активации.', items: (agent?.policy.skills ?? []).map((skill) => contextItem({ id: `skill-${encodeURIComponent(skill.name)}`, type: 'Навык', source: 'Политика машины', scope: agent?.name ?? 'Машина', priority: '8 · навык', title: skill.name, description: skill.description || 'Инструкция навыка', explanation: selectedSkills.has(skill.name) ? 'Выбран; активация определяется текстом сообщения при отправке.' : 'Доступен, но не выбран.', configured: selectedSkills.has(skill.name), available: machineAvailable, includedInNextTurn: false, details: { activationReason: 'Текущее сообщение ещё не отправлено.', ...(skill.command ? { 'Команда навыка': skill.command } : {}) } })) },
    { id: 'capabilities', order: 6, title: 'MCP, приложения и плагины', description: 'Активный каталог вычислен сервером для текущего окружения.', items: [
      ...(['machines', 'read', 'edit', 'bash'] as const).map((name) => contextItem({ id: `mcp-remote-${name}`, type: 'MCP-инструмент', source: 'MCP remote', scope: agent?.name ?? 'Удалённая машина', priority: 'Возможность', title: `remote:${name}`, description: String(mcpToolDetails[`mcp-remote-${name}`]?.['Назначение'] ?? 'Инструмент удалённой машины.'), explanation: machineAvailable ? 'Подключается для эффективной машины.' : 'Машина недоступна.', configured: Boolean(resolution?.agentId), available: machineAvailable, includedInNextTurn: machineAvailable, details: { ...mcpToolDetails[`mcp-remote-${name}`], 'Виден движку CLI': cliMcpServers.some((server) => server.name.includes('remote')) ? 'да' : 'нет данных' } })),
      // Инструменты, которые даёт сам вид чата. Их набор решает `turns.ts` по
      // `assistantKind`, тумблера у них нет — отсюда замок с причиной `kind`.
      // Без них список «что сможет модель» отвечал только за remote и kb, хотя
      // в чате с превью модель ходит браузером, а в Make правит файлы проекта.
      ...kindTools.map((tool) => contextItem({ id: tool.id, type: 'MCP-инструмент', source: tool.source, scope: tool.scope, priority: 'Возможность',
        title: tool.title, description: tool.description,
        // Режим «Только планирование» подключает консоль, Make и канбан с
        // &ro=1 (`turns.ts`): чтение работает, запись отклоняется. Без этой
        // фразы пункт обещал полноценный инструмент, которого в плане нет.
        explanation: (tool.available ? tool.whenAvailable : tool.whenUnavailable)
          + (tool.available && tool.readOnlyInPlan && permissionMode === 'plan' ? ' Режим «Только планирование»: инструмент подключается только на чтение — запись отклоняется.' : ''),
        configured: true, available: tool.available, includedInNextTurn: tool.available,
        details: { 'Инструменты': tool.tools, 'Подключает': tool.source, ...(tool.readOnlyInPlan ? { 'В режиме планирования': 'только чтение' } : {}) } })),
      ...(['search', 'document', 'topics'] as const).map((name) => contextItem({ id: `mcp-kb-${name}`, type: 'MCP-инструмент', source: 'MCP kb', scope: 'База знаний', priority: 'Возможность', title: `kb:${name}`, description: String(mcpToolDetails[`mcp-kb-${name}`]?.['Назначение'] ?? 'Инструмент базы знаний.'), explanation: kbMode === 'off' ? 'БЗ отключена.' : 'Подключается для выбранного режима.', configured: kbMode !== 'off', available: kbMode !== 'off', includedInNextTurn: kbMode !== 'off', details: { ...mcpToolDetails[`mcp-kb-${name}`], 'Виден движку CLI': cliMcpServers.some((server) => server.name.includes('kb')) ? 'да' : 'нет данных' } }))
    ] },
    { id: 'knowledge', order: 7, title: 'База знаний', description: 'Режим и фактически подготовленный автоматический контекст.', items: [
      // Доступность индекса — отдельный вопрос от режима: «авто» при сломанном
      // индексе не добавит ничего, и человек должен видеть это до отправки.
      contextItem({ id: 'knowledge-mode', type: 'База знаний', source: 'Настройки разговора', scope: 'Следующий ход', priority: '9 · дополнительный контекст', title: kbDisplay[kbMode].displayName, description: kbDisplay[kbMode].explanation, explanation: kbStatus && !kbStatus.available ? `Индекс базы знаний недоступен${kbStatus.error ? `: ${kbStatus.error}` : ''}.` : kbMode === 'auto' ? 'Документы ещё не выбраны: текущее сообщение не отправлено.' : kbDisplay[kbMode].explanation, configured: kbMode !== 'off', available: kbMode !== 'off' && kbStatus?.available !== false, includedInNextTurn: kbMode !== 'off' && kbStatus?.available !== false, details: {
        value: kbMode,
        autoContextDocuments: [],
        ...(kbStatus
          ? {
              'Индекс': kbStatus.available ? 'доступен' : 'недоступен',
              'Документов': kbStatus.documents,
              'Разделов (chunks)': kbStatus.chunks,
              'Режим поиска': kbStatus.searchMode,
              ...(kbStatus.staleDocuments ? { 'Устаревших документов': kbStatus.staleDocuments } : {}),
              ...(kbStatus.error ? { 'Ошибка индекса': kbStatus.error } : {})
            }
          : {})
      } })
    ] },
    { id: 'history', order: 8, title: 'История и текущее сообщение', description: 'Серверные метаданные пользовательского контекста.', items: [
      // Правда про resume: при живой сессии CLI история заново НЕ пересобирается —
      // модель помнит её сама, а серверу уходит только новое сообщение. Пока
      // инспектор писал «сохранённая история передаётся», он обещал не то.
      contextItem({ id: 'conversation-history', type: 'История', source: 'Текущий разговор', scope: 'Следующий ход', priority: '10 · история',
        title: 'История разговора',
        description: resumeId
          ? `${messages.length} сообщений уже в сессии движка`
          : `${messages.length} сообщений, ≈${approxTokens(historyText.length)} токенов`,
        explanation: resumeId
          ? 'Ход продолжает сессию движка (resume): история в промпт не пересобирается, уходит только новое сообщение — но все блоки настроек ниже отправляются заново каждым ходом. Сессия сбрасывается при смене движка и правке или удалении сообщений.'
          : messages.length > 0
            ? 'Сессии движка нет — история пересобирается в промпт целиком.'
            : 'Истории пока нет: в ход уйдёт только ваше сообщение.',
        configured: messages.length > 0, available: true, includedInNextTurn: messages.length > 0,
        size: resumeId ? null : { chars: historyText.length, approxTokens: approxTokens(historyText.length) },
        details: { messageCount: messages.length, 'Сессия движка': resumeId ? 'есть (resume)' : 'нет', 'Символов при пересборке': historyText.length } }),
      contextItem({ id: 'current-message', type: 'Текущее сообщение', source: 'Поле ввода', scope: 'Следующий ход', priority: '11 · текущая задача', title: 'Текущее сообщение', description: 'Сообщение ещё не отправлено серверу.', explanation: 'Preview не считает будущий текст включённым.', configured: false, available: false, includedInNextTurn: false })
    ] }
  ]
  // Рост контекста: размеры промптов последних ходов. Отвечает на «почему стало
  // дороже» — из meta.request, без досчёта.
  const prices = db.listModelPrices()
  const turnSizes: ContextTurnSize[] = [...messages]
    .reverse()
    .filter((message) => message.role === 'ai' && message.meta?.request)
    .slice(0, 10)
    .map((message) => {
      const info = message.meta!.request!
      return {
        at: message.time,
        model: info.model,
        chars: info.promptChars,
        approxTokens: approxTokens(info.promptChars),
        resumed: info.resumed,
        costUsd: promptCostUsd(info.provider, info.model, approxTokens(info.promptChars), prices)
      }
    })

  // Несогласованности: настройки формально верны, но вместе дают не то, чего
  // человек ждёт. Считает сервер, а не UI: правила про машину, БЗ и проект живут
  // здесь же, где считается снимок.
  const warnings: ContextWarning[] = []
  if (conversation.projectId && disabled.has('project-binding')) {
    warnings.push({ itemId: 'project-binding', level: 'problem', text: `Чат привязан к проекту${project ? ` «${project.name}»` : ''}, но проектный контекст выключен: модель не узнает о проекте.` })
  }
  if (conversation.projectId && !project) {
    warnings.push({ itemId: 'project-binding', level: 'problem', text: 'Проект чата недоступен: он удалён или доступ к нему потерян.' })
  }
  if (machineAvailable === false && conversation.execTarget && conversation.execTarget !== 'none') {
    warnings.push({ itemId: 'machine', level: 'problem', text: 'Выбранная машина недоступна: команды и файловые инструменты в ход не попадут.' })
  }
  if (disabled.has('knowledge-mode') && conversation.kbContextMode !== 'off') {
    warnings.push({ itemId: 'knowledge-mode', level: 'notice', text: 'База знаний выключена тумблером инспектора, хотя в настройках разговора режим другой: тумблер сильнее.' })
  }
  // Одинаковый текст в двух инструкциях модель получает дважды: это не ошибка
  // конфигурации, но и не то, чего человек хотел — чаще след копирования.
  const instructionTexts = new Map<string, string[]>()
  for (const entry of settings.chatInstructions.filter((item) => item.enabled)) {
    const text = instructionText(entry).trim()
    if (!text) continue
    instructionTexts.set(text, [...(instructionTexts.get(text) ?? []), entry.title])
  }
  for (const [, titles] of instructionTexts) {
    if (titles.length > 1) {
      warnings.push({ itemId: null, level: 'notice', text: `Одинаковый текст в инструкциях: ${titles.join(', ')}. Модель получит его дважды.` })
    }
  }
  // Навык выбран, но машины нет: он не активируется ни при каком сообщении.
  const selectedWithoutMachine = [...selectedSkills].length > 0 && !machineAvailable
  if (selectedWithoutMachine) {
    warnings.push({ itemId: 'machine', level: 'notice', text: `Навыки выбраны (${[...selectedSkills].join(', ')}), но машина недоступна: они не активируются.` })
  }
  // Инструкция обещает терминал или проводник, а инструменты машины выключены:
  // модель предложит открыть их, а выполнить не сможет.
  const toolInstructionActive = settings.chatInstructions.some((entry) =>
    entry.enabled && !disabled.has(instructionContextId(entry.id)) && (entry.kind === 'console' || entry.kind === 'explorer'))
  const remoteOff = ['mcp-remote-bash', 'mcp-remote-read', 'mcp-remote-edit'].every((id) => disabled.has(id))
  if (toolInstructionActive && remoteOff) {
    warnings.push({ itemId: null, level: 'notice', text: 'Инструкции про терминал и проводник включены, а инструменты машины выключены: модель предложит их открыть, но выполнить не сможет.' })
  }
  // Все источники знаний выключены: модель отвечает только по истории и тексту
  // сообщения. Иногда это и нужно, но чаще так выходит случайно.
  const knowledgeSources = ['personalization', 'project-binding', 'knowledge-mode'] as const
  if (knowledgeSources.every((id) => disabled.has(id)) && conversation.projectId) {
    warnings.push({
      itemId: null,
      level: 'problem',
      text: 'Выключены и проект, и база знаний, и персонализация: модель не знает ни о проекте, ни о ваших предпочтениях — только история разговора.'
    })
  }
  // Много постоянных подсказок — это не ошибка, но каждая уходит в каждом ходе,
  // и десяток заметно съедает и место, и внимание модели.
  const activeInstructions = settings.chatInstructions.filter((entry) => entry.enabled && !disabled.has(instructionContextId(entry.id)))
  if (activeInstructions.length > 10) {
    warnings.push({ itemId: null, level: 'notice', text: `Инструкций чата включено ${activeInstructions.length}: все они уходят в каждом ходе. Проверьте, нужны ли редкие из них постоянно.` })
  }
  const disabledInstructions = settings.chatInstructions.filter((entry) => entry.enabled && disabled.has(instructionContextId(entry.id)))
  if (disabledInstructions.length) {
    warnings.push({ itemId: null, level: 'notice', text: `Инструкций чата выключено для этого разговора: ${disabledInstructions.length}. Их ответные блоки (терминал, вопросы, картинки) в ответе тоже не появятся.` })
  }
  if (permissionMode === 'plan' && conversation.permissionMode && conversation.permissionMode !== 'plan') {
    warnings.push({ itemId: 'permission-mode', level: 'notice', text: 'Сервер понизил режим до «Только планирование»: без доступной машины изменения выполнять негде.' })
  }
  warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'problem' ? -1 : 1))

  // Факт последнего хода: `meta.request` сохранённого ответа. Ничего не
  // досчитываем — это ответ на вопрос «что было отправлено», а не прогноз.
  const lastRequest = [...messages].reverse().find((message) => message.role === 'ai' && message.meta?.request)
  const request = lastRequest?.meta?.request
  const lastTurn: ContextLastTurn | null = request
    ? {
        at: lastRequest!.time,
        provider: request.provider,
        model: request.model,
        prompt: request.prompt,
        chars: request.promptChars,
        approxTokens: approxTokens(request.promptChars),
        resumed: request.resumed,
        ...(request.permissionMode ? { permissionMode: request.permissionMode } : {}),
        attachments: request.attachments?.length ?? 0,
        // Имена, а не только количество: «2 вложения» не отвечает на вопрос,
        // какие именно файлы получила модель. Путь на диске не раскрываем.
        attachmentNames: (request.attachments ?? []).map((path) => path.split('/').pop() ?? path),
        kbSections: (request.kbContext?.sections ?? []).map((section) => section.title)
      }
    : null

  // Предпросмотр «что именно уйдёт»: тот же билдер, что у хода модели, поэтому
  // выключенный пункт исчезает и здесь. История и автоконтекст БЗ в него не
  // входят — им нужен текст ещё не отправленного сообщения.
  const previewBlocks = buildContextBlocks({
    personalization: disabled.has('personalization') ? { ...p, preferredName: '', responseLanguage: '', responseStyle: 'normal', tone: 'neutral', birthYear: null, birthMonth: null, birthDay: null } : p,
    // Фильтр по виду чата общий с ходом: в «Консоли с ассистентом» не уходит
    // подсказка про терминал, в Make — про терминал и заведение задачи.
    instructions: instructionsForAssistantKind(effectiveChatInstructions(settings.chatInstructions, disabled), conversation.assistantKind ?? null),
    project: disabled.has('project-binding') ? null : project,
    projectId: disabled.has('project-binding') ? null : conversation.projectId ?? null,
    taskContext,
    // Тумблер `make-context` настоящий: ход его тоже проверяет.
    makeContext: disabled.has('make-context') ? null : makeContext,
    now
  })
  const previewText = previewBlocks.map((block) => block.text).join('\n\n')
  // Всё выключено: модель получит только историю и сообщение. Это законный
  // режим (отладка «а что она сама умеет»), но случайно в него попадают чаще.
  if (!previewBlocks.length && [...disabled].some((id) => isContextToggleable(id))) {
    warnings.push({
      itemId: null,
      level: 'notice',
      text: 'Своих блоков сервер не добавит: выключено всё, что можно. Модель получит только историю разговора и ваше сообщение.'
    })
    warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'problem' ? -1 : 1))
  }
  // Размер: у движков контекст не бесконечный, и «почему модель забыла начало
  // разговора» чаще всего про объём. Порог мягкий — это замечание, не запрет.
  if (approxTokens(previewText.length) > CONTEXT_PREVIEW_TOKENS_NOTICE) {
    warnings.push({
      itemId: null,
      level: 'notice',
      text: `Свои блоки промпта занимают ≈${approxTokens(previewText.length)} токенов — это много для постоянной части каждого хода. Выключите ненужные источники или сократите инструкции чата.`
    })
    warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'problem' ? -1 : 1))
  }
  // Инструкция включена, но в чате этого вида не применяется. Раньше человек
  // видел её в списке «уйдёт» и не понимал, почему модель ведёт себя иначе.
  const skippedByKind = effectiveChatInstructions(settings.chatInstructions, disabled)
    .filter((item) => !instructionsForAssistantKind([item], conversation.assistantKind ?? null).length)
  if (skippedByKind.length) {
    warnings.push({
      itemId: null,
      level: 'notice',
      text: `В чате этого вида не применяются инструкции: ${skippedByKind.map((item) => item.title).join(', ')}. Они включены в настройках, но сюда не уходят.`
    })
    warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'problem' ? -1 : 1))
  }
  // Живая сессия движка: история не пересобирается, но блоки настроек уходят
  // снова каждым ходом — модель их уже видела, а платит за них человек. Порог
  // тот же, что у «истории»: ниже тысячи токенов повтор не стоит разговора.
  if (resumeId && approxTokens(previewText.length) > CONTEXT_HISTORY_TOKENS_NOTICE) {
    warnings.push({
      itemId: null,
      level: 'notice',
      text: `Сессия движка живая: история не пересылается, но ≈${approxTokens(previewText.length)} токенов настроек уходят заново в каждом ходе — модель их уже получила. Выключите лишние источники или начните новый разговор.`
    })
    warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'problem' ? -1 : 1))
  }
  // Закреплённый движок-исполнитель недоступен: ход пойдёт через другой раннер,
  // и человек должен узнать об этом до отправки, а не по логам исполнения.
  if (engineResolution.substituted) {
    warnings.push({
      itemId: 'llm',
      level: 'notice',
      text: `Закреплённый движок-исполнитель недоступен (роль или выключен) — ход выполнит «${engineResolution.engine?.name ?? 'встроенный запуск CLI'}».`
    })
    warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'problem' ? -1 : 1))
  }
  // История больше половины хода: выключать источники в таком чате бессмысленно
  // — место занимают сообщения, а не настройки, и совет должен быть другим.
  if (!resumeId && historyText.length > previewText.length && approxTokens(historyText.length) > CONTEXT_HISTORY_TOKENS_NOTICE) {
    warnings.push({
      itemId: 'conversation-history',
      level: 'notice',
      text: `История разговора занимает ≈${approxTokens(historyText.length)} токенов — больше, чем все настройки вместе (≈${approxTokens(previewText.length)}). Выключение источников тут почти ничего не изменит: помогает новый разговор или продолжение сессии движка.`
    })
    warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'problem' ? -1 : 1))
  }
  // Рост: абсолютный порог молчит, пока контекст не станет большим, а «стало
  // вдвое больше, чем в прошлые ходы» — это про сегодняшнюю правку, и заметить
  // её надо сразу. Сравниваем с фактическими размерами ходов из истории.
  if (turnSizes.length >= CONTEXT_GROWTH_MIN_TURNS) {
    const average = turnSizes.reduce((total, turn) => total + turn.approxTokens, 0) / turnSizes.length
    const current = approxTokens(previewText.length)
    if (average > 0 && current > average * CONTEXT_GROWTH_RATIO_NOTICE) {
      warnings.push({
        itemId: null,
        level: 'notice',
        text: `Постоянная часть выросла: ≈${current} токенов против ≈${Math.round(average)} в среднем за последние ${turnSizes.length} ход(ов). Проверьте, что добавилось — журнал изменений ниже.`
      })
      warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'problem' ? -1 : 1))
    }
  }
  // Размер вклада: у пункта, за которым стоит блок промпта, — размер его блока.
  // Склеенная подсказка одна на два пункта: размер получают оба — вопрос «что
  // именно занимает место» задают про пункт, а итог берётся из предпросмотра.
  const sizeByItem = new Map(previewBlocks.flatMap((block) => block.itemIds.map((id) => [id, { chars: block.chars, approxTokens: block.approxTokens }] as const)))
  // Размер из предпросмотра, а если пункт посчитал свой сам (история) — его.
  const withSizes = groups.map((group) => {
    const items = group.items.map((item) => ({ ...item, size: sizeByItem.get(item.id) ?? item.size ?? null }))
    // Итог группы считаем по блокам предпросмотра, а не суммой размеров пунктов:
    // склеенная подсказка принадлежит двум пунктам, и сумма её удвоила бы.
    const chars = previewBlocks
      .filter((block) => block.itemIds.some((id) => items.some((item) => item.id === id)))
      .reduce((total, block) => total + block.chars, 0)
    return { ...group, items, size: chars > 0 ? { chars, approxTokens: approxTokens(chars) } : null }
  })
  return {
    schemaVersion: 1,
    conversationId,
    generatedAt: now.toISOString(),
    freshnessWarning: 'Снимок отражает сохранённую конфигурацию на момент формирования. До отправки следующего сообщения настройки, доступность машин и контекст могут измениться.',
    summary: { provider, model, permissionMode: { value: permissionMode, ...permissionDisplay[permissionMode] }, kbMode: { value: kbMode, ...kbDisplay[kbMode] } },
    groups: withSizes,
    viewerRole: role,
    owner: userId,
    foreign: viewer !== userId,
    turnSizes,
    lastTurn,
    changes: db.listConversationContextEvents(userId, conversationId, 20),
    // Тот же список, что уйдёт исполнителю (`turns.ts` → LlmRequest.disallowedTools).
    disallowedTools: [
      ...[...disabled].map(toolNameForContextId).filter((tool): tool is string => tool !== null),
      // Make: ход глушит встроенные инструменты вместо понижения режима —
      // значит модель их не получит, и список это обязан показывать.
      ...(makeChat ? MAKE_ONLY_DISALLOWED_TOOLS : [])
    ].sort(),
    cliMcpServers,
    warnings,
    promptPreview: {
      blocks: previewBlocks,
      text: previewText,
      chars: previewText.length,
      approxTokens: promptBlock([], '', previewText).approxTokens,
      costUsd: promptCostUsd(provider, model, approxTokens(previewText.length), prices),
      // Итог хода: постоянная часть плюс история. При живой сессии движка
      // история заново не уходит — тогда итог равен постоянной части.
      turnTotal: {
        chars: previewText.length + (resumeId ? 0 : historyText.length),
        approxTokens: approxTokens(previewText.length + (resumeId ? 0 : historyText.length)),
        historyChars: resumeId ? 0 : historyText.length,
        historyApproxTokens: resumeId ? 0 : approxTokens(historyText.length),
        resumed: Boolean(resumeId)
      },
      // Те же токены по прайсу других моделей движка: вопрос «а если перейти
      // на модель попроще» задают, глядя ровно на эту цифру.
      costByModel: (provider === 'claude' ? CLAUDE_MODELS.map((entry) => entry.id) : CODEX_MODELS.map((entry) => entry.id))
        .filter((candidate) => candidate !== model)
        .map((candidate) => ({ model: candidate, costUsd: promptCostUsd(provider, candidate, approxTokens(previewText.length + (resumeId ? 0 : historyText.length)), prices) }))
        .filter((entry): entry is { model: string; costUsd: number } => entry.costUsd !== null),
      omitted: [
        'Правила платформы и приложения: их добавляет CLI движка, сервер их текст не хранит.',
        // Системные хинты, которые к промпту приклеивает сам исполнитель CLI.
        // Их условия сервер знает (машина, режим БЗ, вид чата), а тексты для
        // части хинтов лежат в shared — тогда называем и размер. Без этих строк
        // «полный просмотр» молчал о заметной части того, что читает модель.
        ...(machineAvailable
          ? ['Хинт CLI про машину: встроенный Bash отключён, команды и файлы идут через mcp__remote__* (текст живёт в исполнителе).']
          : ['Хинт CLI: машина не выбрана — shell-команды этому ходу запрещены (текст живёт в исполнителе).']),
        ...(kbMode !== 'off'
          ? [`Хинт CLI про инструменты базы знаний (режим «${kbMode}»): ≈${approxTokens(kbToolHint(kbMode).length)} токенов.`]
          : []),
        ...(conversation.assistantKind !== 'make'
          ? [`Хинт CLI про браузер превью: ≈${approxTokens(previewToolHint().length)} токенов (в чатах с поверхностью превью).`]
          : []),
        ...(conversation.assistantKind === 'make'
          ? [`Хинт CLI ассистента Make: ≈${approxTokens(MAKE_ASSISTANT_HINT.length)} токенов.`]
          : []),
        ...(conversation.assistantKind === 'console-reader'
          ? ['Хинт CLI про живую консоль: работа в PTY-сессии пользователя (текст живёт в исполнителе).']
          : []),
        ...(conversation.projectId
          ? [`Хинт CLI канбан-ассистента (только ходы из панели): ≈${approxTokens(KANBAN_ASSISTANT_HINT.length)} токенов.`]
          : []),
        // Эти блоки собираются в момент хода из того, что происходит на экране
        // или из режима запуска: показать их «как будет» снимок не может, но
        // молчать о них тоже нельзя — человек видит их следы в ответах.
        ...(conversation.assistantKind === 'make'
          ? ['Режим Make: при «Только планирование» ход получает блок «Режим вопроса», а на больших переделках — «Режим плана». Оба добавляются в момент отправки.']
          : []),
        ...(conversation.projectId
          ? ['Режим канбан-ассистента: снимок доски и открытого экрана добавляется, только когда сообщение отправлено из панели ассистента.']
          : []),
        resumeId
          ? 'История разговора: ход продолжает сессию движка, история заново не отправляется. Блоки выше — отправляются, каждым ходом.'
          : `История разговора: пересобирается в момент отправки, ≈${approxTokens(historyText.length)} токенов.`,
        'Текущее сообщение: его текст ещё не отправлен серверу.',
        kbMode === 'off' ? 'Автоконтекст базы знаний: режим выключен.' : 'Автоконтекст базы знаний: документы подбираются по тексту отправляемого сообщения.',
        'AGENTS.md: файл читает исполнитель в рабочей директории машины.'
      ]
    }
  }
}
import type { AuthStatusState } from '../auth/statusState.js'
import { listProjects, listSessions, readTranscript, readUsage } from '../cc/ccSessions.js'
import {
  listCxProjects,
  listCxSessions,
  readCxTranscript,
  readCxUsage
} from '../codex/codexSessions.js'

/** Флаг из query-строки: `?includeCompleted=1` (или `=true`). */
function queryFlag(v: string | undefined): boolean {
  return v === '1' || v === 'true'
}

const CONVERSATION_SCOPES = ['chat', 'kanban', 'make', 'images', 'console', 'playwright-reader', 'web-reader'] as const
function parseConversationScope(value: string | undefined): (typeof CONVERSATION_SCOPES)[number] | null {
  return CONVERSATION_SCOPES.includes(value as (typeof CONVERSATION_SCOPES)[number])
    ? value as (typeof CONVERSATION_SCOPES)[number]
    : null
}

export async function registerRest(
  app: FastifyInstance,
  db: VoiceChatDb,
  dataDir: string,
  opts: {
    runnerFs?: RunnerFsClient
    authStatus?: AuthStatusState
    isAgentOnline?: (agentId: string) => boolean
    /**
     * База знаний — функцией: сервис создаётся в `server.ts` позже регистрации
     * REST, поэтому передаётся геттер, а не готовый объект.
     */
    kb?: () => KnowledgeBaseService | null
    /** Чтение файла на машине (реестр агентов живёт в server.ts). */
    fsRead?: (agentId: string, path: string) => Promise<{ dataBase64?: string }>
    /** Живой статус машин (online, версия, телеметрия): реестр агентов живёт в server.ts. */
    liveAgents?: (agents: ReturnType<VoiceChatDb['listAgents']>) => AgentInfo[]
    /**
     * Контекст Make-проекта для предпросмотра: тот же текст, что ход добавляет
     * к промпту. Мастерская живёт в `server.ts`, поэтому приходит функцией.
     */
    makeContext?: (conversationId: string) => Promise<string>
    /**
     * Разовое обновление общей копии проекта до origin/<base>. Единственное, что
     * Make делает с репозиторием: новый Make-чат начинает работу от актуального
     * main, а сами ходы к машине уже не ходят (`turns.ts`: makeChat). Вызов
     * best-effort и без await — создание чата не ждёт сети и не падает из-за
     * offline-машины.
     */
    refreshProjectMain?: (userId: string, projectId: string) => void
  } = {}
): Promise<void> {
  const profile = (req: Parameters<typeof uid>[0]) => ensureCliProfile(dataDir, uid(req))
  const ccDir = (req: Parameters<typeof uid>[0]) => process.env.VC_CC_DIR ?? profile(req).ccProjects
  const cxDir = (req: Parameters<typeof uid>[0]) => process.env.VC_CODEX_DIR ?? profile(req).codexSessions
  const runnerFs = opts.runnerFs
  /**
   * Статус индекса БЗ для снимка контекста. Сломанный индекс не должен ронять
   * снимок: он про конфигурацию разговора, а не про здоровье поиска.
   */
  const kbStatusSafe = (): KbStatus | null => {
    try {
      return opts.kb?.()?.status() ?? null
    } catch {
      return null
    }
  }
  const proxyError = (reply: FastifyReply, err: unknown) =>
    reply.code(502).send({ error: 'runner_unavailable', message: err instanceof Error ? err.message : String(err) })
  // Файл с диска сервера (картинки, созданные самим CLI). Своя область — профиль
  // CLI пользователя, его загрузки и заданный им рабочий каталог; всё остальное
  // неотличимо от «нет такого файла». Проверка пути — `serverFiles.ts`.
  app.get<{ Querystring: { path?: string } }>(REST.serverFile, async (req, reply) => {
    const userId = uid(req)
    if (runnerFs) {
      try {
        const remote = await runnerFs.readFile(userId, req.query.path ?? '')
        if (remote) return remote
      } catch (err) {
        return proxyError(reply, err) as never
      }
    }
    const workdir = db.getSettings(userId).workdir
    const roots = [profile(req).home, join(dataDir, 'uploads'), ...(workdir ? [workdir] : [])]
    const res = readUserFile(req.query.path ?? '', roots)
    if (!res.ok) {
      const code = res.reason === 'too-large' ? 413 : 404
      return reply.code(code).send({ error: res.reason }) as never
    }
    return res.file
  })

  // includeCompleted=1 — вместе с чатами задач, лежащих в колонке «Готово»
  // (по умолчанию их в списке нет, см. `listConversations`).
  app.get<{ Querystring: { scope?: string; projectId?: string; includeCompleted?: string } }>(REST.conversations, async (req, reply) => {
    const scope = req.query.scope === undefined ? 'chat' : parseConversationScope(req.query.scope)
    if (!scope || (scope === 'kanban' && !req.query.projectId)) return reply.code(400).send({ error: 'valid scope and kanban projectId are required' })
    return db.listConversations(uid(req), { scope, projectId: req.query.projectId, includeCompleted: queryFlag(req.query.includeCompleted) })
  })
   app.post<{ Body: DesktopMigrationBundle }>(REST.desktopMigration, async (req, reply) => {
    if (!req.body || !Array.isArray(req.body.conversations)) return reply.code(400).send({ error: 'invalid migration bundle' })
    return db.importDesktopData(uid(req), req.body)
  })

  app.post<{ Body: { title?: string; scope?: string; projectId?: string | null; assistantKind?: 'web-recorder' | 'playwright-reader' | 'console-reader' | 'make' | 'images' } }>(REST.conversations, async (req, reply) => {
    const kind = req.body?.assistantKind
    const scope = req.body?.scope === undefined
      ? kind === 'web-recorder' ? 'web-reader' : kind === 'playwright-reader' ? 'playwright-reader' : kind === 'console-reader' ? 'console' : kind === 'make' ? 'make' : kind === 'images' ? 'images' : 'chat'
      : parseConversationScope(req.body.scope)
    if (!scope || (scope === 'kanban' && !req.body?.projectId)) return reply.code(400).send({ error: 'valid scope and kanban projectId are required' })
    try {
      const conversation = db.createConversation(uid(req), req.body?.title, kind === 'web-recorder' || kind === 'playwright-reader' || kind === 'console-reader' || kind === 'make' || kind === 'images' ? kind : null, req.body?.projectId ?? null, scope)
      // Новый Make-чат стартует от актуального main: копию обновляет сервер один
      // раз здесь, потому что сама модель Make к репозиторию доступа не имеет.
      if (kind === 'make' && conversation?.projectId) opts.refreshProjectMain?.(uid(req), conversation.projectId)
      return conversation
    } catch (error) {
      if (error instanceof Error && error.message === 'project not found') return reply.code(404).send({ error: error.message })
      throw error
    }
  })

  app.get<{ Params: { projectId: string }; Querystring: { conversationId?: string } }>('/api/projects/:projectId/kanban-assistant', async (req, reply) => {
    const userId = uid(req)
    const privateConversation = db.ensureKanbanAssistantConversation(userId, req.params.projectId)
    const requested = req.query.conversationId ? db.getConversation(userId, req.query.conversationId, { scope: 'kanban', projectId: req.params.projectId }) : null
    const conversation = requested?.projectId === req.params.projectId && requested.scope === 'kanban'
      ? requested
      : privateConversation
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    const project = db.getCiLlmConfig('project', req.params.projectId) ?? db.ciLlmDefaultsForUser(userId)
    const settings = db.getSettings(userId)
    const provider = conversation.llmProvider ?? project.provider
    const model = conversation.llmProvider
      ? (conversation.llmModel ?? (provider === 'codex' ? settings.codexModel : settings.model))
      : project.model
    return {
      conversation,
      messages: db.listMessages(userId, conversation.id),
      effectiveLlm: {
        llmEngineId: conversation.llmEngineId ?? project.llmEngineId ?? settings.llmEngineId,
        provider,
        model,
        inherited: conversation.llmProvider === null && conversation.llmEngineId === null
      }
    }
  })

  // Автономия канбан-ассистента живёт на разговоре: у одного пользователя может
  // быть «делай сам» в одном проекте и «спрашивай» в другом.
  app.post<{ Params: { id: string }; Body: { autonomy?: string } }>('/api/conversations/:id/assistant-autonomy', async (req, reply) => {
    const autonomy = req.body?.autonomy === 'confirm' ? 'confirm' : 'auto'
    const updated = db.setConversationAutonomy(uid(req), req.params.id, autonomy)
    return updated ?? reply.code(404).send({ error: 'not found' })
  })

  app.post<{
    Body: { idempotencyKey?: string; title?: string; projectId?: string | null; message?: Omit<AddMessageArgs, 'conversationId'> }
  }>(REST.conversationDraft, async (req, reply) => {
    const { idempotencyKey, title, projectId, message } = req.body ?? {}
    if (!idempotencyKey?.trim() || !title?.trim() || !message) {
      return reply.code(400).send({ error: 'idempotencyKey, title and message are required' })
    }
    try {
      return db.createConversationDraft(uid(req), idempotencyKey, title, projectId ?? null, message)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.get<{ Querystring: { q?: string; scope?: string; projectId?: string; includeCompleted?: string } }>(REST.conversationsSearch, async (req, reply) => {
    const scope = req.query.scope === undefined ? 'chat' : parseConversationScope(req.query.scope)
    if (!scope || (scope === 'kanban' && !req.query.projectId)) return reply.code(400).send({ error: 'valid scope and kanban projectId are required' })
    return db.searchConversations(uid(req), req.query.q ?? '', { scope, projectId: req.query.projectId, includeCompleted: queryFlag(req.query.includeCompleted) })
  })

  /**
   * Полнотекстовый поиск по сообщениям (FTS5). `projectId` со значением `none`
   * (или пустым) — только беседы без проекта, параметра нет — по всем.
   * Владельца подставляет `uid(req)`: чужие сообщения не выдаются никогда.
   */
  app.get<{
    Querystring: { q?: string; projectId?: string; conversationId?: string; limit?: string; cursor?: string }
  }>(REST.messagesSearch, async (req) => {
    const { q, projectId, conversationId, limit, cursor } = req.query
    return db.searchMessages(uid(req), {
      q: q ?? '',
      projectId: projectId === undefined ? undefined : projectId === '' || projectId === 'none' ? null : projectId,
      ...(conversationId ? { conversationId } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
      cursor: cursor ?? null
    })
  })

  app.get<{ Params: { id: string }; Querystring: { scope?: string; projectId?: string } }>('/api/conversations/:id', async (req, reply) => {
    const scope = req.query.scope === undefined ? 'chat' : parseConversationScope(req.query.scope)
    if (!scope || (scope === 'kanban' && !req.query.projectId)) return reply.code(400).send({ error: 'valid scope and kanban projectId are required' })
    const conversation = db.getConversation(uid(req), req.params.id, { scope, projectId: req.query.projectId })
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    return { conversation, messages: db.listMessages(uid(req), req.params.id) }
  })

  /**
   * Владелец разговора для чтения снимка. Свой чат — сам пользователь. Чужой
   * открывается **только администратору**: «почему этот чат отвечает иначе» —
   * его рабочий вопрос, а данные читаются scope владельца, иначе снимок пуст.
   * Остальным чужой разговор по-прежнему неотличим от несуществующего.
   */
  const contextOwnerFor = (req: Parameters<typeof uid>[0], conversationId: string): string | null => {
    const viewer = uid(req)
    if (db.getConversation(viewer, conversationId)) return viewer
    if ((db.getUser(viewer)?.role ?? 'developer') !== 'admin') return null
    return db.conversationOwner(conversationId)
  }

  app.get<{ Params: { id: string } }>('/api/conversations/:id/context-snapshot', async (req, reply) => {
    // Список MCP-серверов спрашиваем у самого движка: он показывает, что видит
    // CLI, а не что подключает приложение. Ошибка или отсутствие движка не
    // должны ломать снимок — тогда список просто пуст.
    const cliMcp = await listMcpServers().catch(() => [])
    const owner = contextOwnerFor(req, req.params.id)
    // Контекст Make-проекта (токены темы и открытые комментарии) уходит в ход
    // отдельным блоком. Читается с диска, поэтому здесь, а не внутри снимка:
    // сам снимок синхронный. Ошибка чтения не должна ломать экран — тогда
    // блока просто не будет, как и в ходе (там та же `.catch`).
    const makeConv = owner ? db.getConversation(owner, req.params.id) : null
    const makeContextText = makeConv?.assistantKind === 'make' && opts.makeContext
      ? await opts.makeContext(req.params.id).catch(() => '')
      : null
    const snapshot = owner ? contextSnapshot(db, owner, req.params.id, { isOnline: opts.isAgentOnline, kbStatus: kbStatusSafe(), cliMcpServers: cliMcp, viewer: uid(req), makeContext: makeContextText }) : null
    if (!snapshot) return reply.code(404).send({ error: 'not found' })
    return snapshot
  })
  // Включить/выключить пункт контекста: выключенный не попадает ассистенту в
  // следующих ходах (turns.ts). Правила безопасности сервер выключить не даёт.
  app.post<{ Params: { id: string; itemId: string }; Body: { enabled?: boolean } }>('/api/conversations/:id/context/:itemId', async (req, reply) => {
    if (!isContextToggleable(req.params.itemId)) return reply.code(400).send({ error: 'Этот пункт нельзя выключить' })
    // Владелец — чей scope правим; actor — кто правит. Для админа это разные
    // люди, и журнал должен показать именно того, кто нажал.
    const owner = contextOwnerFor(req, req.params.id)
    if (!owner) return reply.code(404).send({ error: 'not found' })
    const updated = db.setConversationContextEnabled(owner, req.params.id, req.params.itemId, req.body?.enabled !== false, uid(req))
    if (!updated) return reply.code(404).send({ error: 'not found' })
    const snapshot = contextSnapshot(db, owner, req.params.id, { isOnline: opts.isAgentOnline, kbStatus: kbStatusSafe(), viewer: uid(req) })
    return snapshot ?? reply.code(404).send({ error: 'not found' })
  })

  /**
   * Чем контекст этого разговора отличается от другого. Только чтение: вопрос
   * «почему там работает, а здесь нет» задают до того, как что-то перезаписать
   * копированием. Оба снимка строятся тем же `contextSnapshot`, поэтому
   * сравниваются ровно те значения, которые видит человек.
   */
  app.get<{ Params: { id: string; otherId: string } }>('/api/conversations/:id/context-diff/:otherId', async (req, reply) => {
    const userId = uid(req)
    const here = contextSnapshot(db, userId, req.params.id, { isOnline: opts.isAgentOnline, kbStatus: kbStatusSafe() })
    const there = contextSnapshot(db, userId, req.params.otherId, { isOnline: opts.isAgentOnline, kbStatus: kbStatusSafe() })
    const otherConversation = db.getConversation(userId, req.params.otherId)
    if (!here || !there || !otherConversation) return reply.code(404).send({ error: 'not found' })
    const itemsOf = (snapshot: ConversationContextSnapshot): Map<string, ContextSnapshotItem> =>
      new Map(snapshot.groups.flatMap((group) => group.items).map((item) => [item.id, item]))
    const hereItems = itemsOf(here)
    const thereItems = itemsOf(there)
    const disabledOnly = (from: Map<string, ContextSnapshotItem>, other: Map<string, ContextSnapshotItem>) =>
      [...from.values()]
        .filter((item) => item.toggleable && !item.enabled && other.get(item.id)?.enabled !== false)
        .map((item) => ({ itemId: item.id, title: item.title }))
    const settings: ContextDiff['settings'] = []
    const compare = (label: string, hereValue: string, thereValue: string): void => {
      if (hereValue !== thereValue) settings.push({ label, here: hereValue, there: thereValue })
    }
    compare('Движок', here.summary.provider, there.summary.provider)
    compare('Модель', here.summary.model || 'из конфигурации CLI', there.summary.model || 'из конфигурации CLI')
    compare('Режим доступа', here.summary.permissionMode.displayName, there.summary.permissionMode.displayName)
    compare('База знаний', here.summary.kbMode.displayName, there.summary.kbMode.displayName)
    return {
      otherId: otherConversation.id,
      otherTitle: otherConversation.title,
      onlyThere: disabledOnly(thereItems, hereItems),
      onlyHere: disabledOnly(hereItems, thereItems),
      settings
    } satisfies ContextDiff
  })

  /**
   * Скопировать выключения контекста из другого разговора. Оба разговора
   * читаются через scope пользователя, поэтому чужой источник просто не
   * найдётся. Копируются только выключаемые пункты: безопасность и информация
   * тумблера не имеют, и «скопировать» их нечего.
   */
  app.post<{ Params: { id: string }; Body: { fromConversationId?: string } }>('/api/conversations/:id/context-copy', async (req, reply) => {
    const userId = uid(req)
    const target = db.getConversation(userId, req.params.id)
    const source = req.body?.fromConversationId ? db.getConversation(userId, req.body.fromConversationId) : null
    if (!target || !source) return reply.code(404).send({ error: 'not found' })
    if (source.id === target.id) return reply.code(400).send({ error: 'Разговор-источник совпадает с текущим' })
    const wanted = new Set((source.disabledContext ?? []).filter(isContextToggleable))
    const current = new Set((target.disabledContext ?? []).filter(isContextToggleable))
    for (const itemId of new Set([...wanted, ...current])) {
      const shouldBeEnabled = !wanted.has(itemId)
      const enabledNow = !current.has(itemId)
      if (enabledNow === shouldBeEnabled) continue // уже как надо
      db.setConversationContextEnabled(userId, target.id, itemId, shouldBeEnabled, userId)
    }
    const snapshot = contextSnapshot(db, userId, target.id, { isOnline: opts.isAgentOnline, kbStatus: kbStatusSafe() })
    return snapshot ?? reply.code(404).send({ error: 'not found' })
  })

  /**
   * Что подберёт база знаний для этого черновика. Снимок описывает сохранённое
   * состояние и на вопрос «а что придёт из БЗ» ответить не может: подбор зависит
   * от текста, который ещё не отправлен. Считает тот же `buildKbAutoContext`,
   * что и ход модели, и с тем же правом просмотра (`kbViewOf`), поэтому чужие
   * разделы в предпросмотр не попадают.
   */
  app.post<{ Params: { id: string }; Body: { draft?: string } }>('/api/conversations/:id/context-kb-preview', async (req, reply) => {
    const userId = uid(req)
    const conversation = db.getConversation(userId, req.params.id)
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    const disabled = new Set(conversation.disabledContext ?? [])
    const mode = disabled.has('knowledge-mode') ? 'off' : (conversation.kbContextMode ?? 'auto')
    const draft = (req.body?.draft ?? '').trim()
    const empty = (emptyReason: string): ContextKbPreview =>
      ({ mode, text: '', chars: 0, approxTokens: 0, confidence: null, sections: [], emptyReason })
    if (mode !== 'auto') return empty('mode')
    if (!draft) return empty('empty-query')
    const kb = opts.kb?.()
    if (!kb) return empty('kb-unavailable')
    const auto = await buildKbAutoContext(kb, draft, {
      ...kbViewOf(db, userId),
      ...(conversation.projectId ? { projectId: conversation.projectId } : {})
    })
    return {
      mode,
      text: auto.text,
      chars: auto.text.length,
      approxTokens: approxTokens(auto.text.length),
      confidence: auto.bundle.confidence,
      // `sections` (а не `contextSections`) — там точная длина блока каждого
      // раздела: человек видит, сколько места займёт именно этот документ.
      sections: auto.sections.map((section) => ({
        documentId: section.documentId,
        title: section.title ?? section.documentId,
        ...(section.anchor ? { anchor: section.anchor } : {}),
        chars: section.chars
      })),
      emptyReason: auto.text ? null : (auto.emptyReason ?? 'no-match')
    } satisfies ContextKbPreview
  })

  /**
   * Цепочка AGENTS.md рабочей директории — по явной просьбе человека, а не в
   * снимке: файл лежит на чужой машине, и молча читать его сервер не должен.
   * Порядок — от общей к конкретной, как её применяет CLI; каталоги выше
   * рабочей директории проверяются вверх до корня.
   */
  app.get<{ Params: { id: string } }>('/api/conversations/:id/agents-chain', async (req, reply) => {
    const userId = uid(req)
    const conversation = db.getConversation(userId, req.params.id)
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    const resolution = db.resolveConversationMachine(userId, req.params.id, { ...(opts.isAgentOnline ? { isOnline: opts.isAgentOnline } : {}) })
    const project = conversation.projectId ? db.getProject(userId, conversation.projectId) : null
    const projectMachine = project?.machines.find((entry) => entry.agentId === resolution?.agentId)
    const workdir = conversation.workdir ?? projectMachine?.path ?? db.getSettings(userId).workdir ?? null
    const agent = resolution?.agentId ? db.listUsableAgents(userId, conversation.projectId).find((a) => a.id === resolution.agentId) : undefined
    const machineName = agent?.name ?? null
    if (!workdir) return { machineName, workdir: null, files: [], unavailable: 'Рабочая директория не задана: цепочку читать негде.' } satisfies AgentsChainResult
    if (!resolution?.agentId || resolution.error || !opts.fsRead) {
      return { machineName, workdir, files: [], unavailable: 'Машина недоступна: прочитать файлы её директории нельзя.' } satisfies AgentsChainResult
    }
    const files: AgentsChainFile[] = []
    for (const dir of agentsChainDirs(workdir)) {
      const path = `${dir.replace(/\/+$/, '')}/AGENTS.md`
      try {
        const result = await opts.fsRead(resolution.agentId, path)
        const dataBase64 = (result as { dataBase64?: string }).dataBase64
        if (!dataBase64) continue // файла нет — обычный случай, в цепочку не попадает
        const text = Buffer.from(dataBase64, 'base64').toString('utf8')
        files.push({ path, text, chars: text.length })
      } catch (error) {
        // «Файла нет» — обычное дело для предков рабочей директории, и строкой
        // об ошибке это показывать нельзя: цепочка утонет в шуме. Всё остальное
        // (отказ политики, таймаут) человек увидеть должен.
        const message = error instanceof Error ? error.message : String(error)
        if (/ENOENT|not found|No such file/i.test(message)) continue
        files.push({ path, text: null, chars: 0, error: message })
      }
    }
    return { machineName, workdir, files } satisfies AgentsChainResult
  })

  app.patch<{
    Params: { id: string }
    Body: {
      title?: string
      execTarget?: string | null
      workdir?: string | null
      skillNames?: string[]
      llmEngineId?: string | null
      llmProvider?: string | null
      llmModel?: string | null
      permissionMode?: string | null
      kbContextMode?: string
    }
  }>(
    '/api/conversations/:id',
    async (req, reply) => {
      const userId = uid(req)
      const current = db.getConversation(userId, req.params.id)
      if (!current) return reply.code(404).send({ error: 'not found' })
      if (
        req.body.execTarget !== undefined &&
        req.body.execTarget !== null &&
        req.body.execTarget !== 'none' &&
        !db.canUseAgent(userId, req.body.execTarget, current.projectId)
      ) {
        return reply.code(403).send({ error: 'machine is not available for this conversation' })
      }
      if (typeof req.body.title === 'string') db.renameConversation(userId, req.params.id, req.body.title)
      if (req.body.kbContextMode === 'auto' || req.body.kbContextMode === 'manual' || req.body.kbContextMode === 'off') db.setConversationKbContextMode(uid(req), req.params.id, req.body.kbContextMode)
      if (req.body.execTarget !== undefined) {
        const role = db.getUser(uid(req))?.role ?? 'developer'
        if (req.body.llmEngineId && !db.listLlmEnginesForRole(role).some((engine) => engine.id === req.body.llmEngineId)) {
          return reply.code(403).send({ error: 'llm engine is not available for role' })
        }
        // Неизвестное значение движка приравниваем к «из общих настроек».
        const llmProvider =
          req.body.llmProvider === undefined
            ? undefined
            : req.body.llmProvider === 'claude' || req.body.llmProvider === 'codex'
              ? req.body.llmProvider
              : null
        // Неизвестный режим прав приравниваем к «из общих настроек».
        const permissionMode =
          req.body.permissionMode === undefined
            ? undefined
            : req.body.permissionMode === 'plan' || req.body.permissionMode === 'acceptEdits' || req.body.permissionMode === 'bypassPermissions'
              ? req.body.permissionMode
              : null
        db.setConversationExecTarget(
          uid(req),
          req.params.id,
          req.body.execTarget,
          req.body.workdir,
          req.body.skillNames,
          llmProvider,
          req.body.llmModel,
          permissionMode,
          req.body.llmEngineId
        )
      }
      const conversation = db.getConversation(uid(req), req.params.id)
      if (!conversation) return reply.code(404).send({ error: 'not found' })
      // Журнал контекста: смена настроек разговора — такое же изменение того,
      // что получит модель, как и тумблер источника. Раньше «кто понизил режим
      // доступа» не отвечал никто: писались только тумблеры.
      // Пишем только то, что пришло в запросе. Иначе переименование чата давало
      // четыре записи «изменил → из общих настроек»: у настройки не было
      // прежнего значения, и первая запись выглядела изменением. Журнал из-за
      // такого шума перестаёт отвечать на вопрос «кто менял контекст».
      const settingEvents: Array<[string, string | null | undefined]> = [
        ...(req.body.permissionMode !== undefined ? [['permission-mode', conversation.permissionMode ?? 'из общих настроек'] as [string, string]] : []),
        ...(req.body.kbContextMode !== undefined ? [['knowledge-mode', conversation.kbContextMode ?? 'auto'] as [string, string]] : []),
        ...(req.body.llmProvider !== undefined || req.body.llmModel !== undefined
          ? [['llm', conversation.llmProvider ? `${conversation.llmProvider}${conversation.llmModel ? ` · ${conversation.llmModel}` : ''}` : 'из общих настроек'] as [string, string]]
          : []),
        ...(req.body.execTarget !== undefined ? [['machine', conversation.execTarget ?? 'резолвер сервера'] as [string, string]] : [])
      ]
      for (const [itemId, value] of settingEvents) {
        if (typeof value === 'string') db.recordConversationSettingEvent(uid(req), req.params.id, itemId, value, uid(req))
      }
      return conversation
    }
  )

  // Метки чатов задач для списка бесед: ключ, тип и последний ран. Статический
  // путь объявлен до `/api/conversations/:id`, но Fastify и так предпочитает его
  // параметрическому — «task-chats» не будет прочитан как id беседы.
  app.get(REST.conversationTaskChats, async (req) => db.taskChatBadges(uid(req)))

  // Контекст задачи для шапки связанного чата (проект/эпик/стори/этап/машина/ран).
  app.get<{ Params: { id: string } }>('/api/conversations/:id/task-context', async (req, reply) => {
    if (!db.getConversation(uid(req), req.params.id)) return reply.code(404).send({ error: 'not found' })
    return db.getTaskChatContext(uid(req), req.params.id, opts.isAgentOnline)
  })

  app.post<{ Params: { id: string }; Body: { projectId?: string | null } }>(
    '/api/conversations/:id/project',
    async (req, reply) => {
      const conversation = db.setConversationProject(uid(req), req.params.id, req.body?.projectId ?? null)
      if (!conversation) return reply.code(404).send({ error: 'not found' })
      return conversation
    }
  )

  app.post<{ Params: { id: string }; Body: { previewUrl?: string | null } }>(
    '/api/conversations/:id/preview-url',
    async (req, reply) => {
      const raw = req.body?.previewUrl
      let previewUrl: string | null = null
      if (raw) {
        try {
          const url = new URL(raw.trim())
          if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
          previewUrl = url.toString()
        } catch {
          return reply.code(400).send({ error: 'previewUrl must be an http/https URL' })
        }
      }
      const conversation = db.setConversationPreviewUrl(uid(req), req.params.id, previewUrl)
      if (!conversation) return reply.code(404).send({ error: 'not found' })
      return conversation
    }
  )

  app.post<{ Params: { id: string }; Body: { status?: string } }>(
    '/api/conversations/:id/status',
    async (req, reply) => {
      const status = req.body?.status
      if (!CONVERSATION_STATUSES.some((s) => s.id === status)) {
        return reply.code(400).send({ error: 'invalid status' })
      }
      const conversation = db.setConversationStatus(uid(req), req.params.id, status as ConversationStatus)
      if (!conversation) return reply.code(404).send({ error: 'not found' })
      return conversation
    }
  )

  app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    try {
      db.deleteConversation(uid(req), req.params.id)
      return { ok: true }
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post<{ Params: { id: string }; Body: AddMessageArgs }>(
    '/api/conversations/:id/messages',
    async (req) => {
      const { messageId, role, text, time, engine, meta, execTarget, attachments } = req.body
      const userId = uid(req)
      // Ответ без движка/машины (самодиагностика пишет текст сама) получает
      // эффективные значения разговора: проектное наследование знает только сервер.
      let effectiveEngine = engine
      let effectiveTarget = execTarget
      if (role === 'ai' && (engine === undefined || execTarget === undefined)) {
        const conversation = db.getConversation(userId, req.params.id)
        if (engine === undefined) {
          const settings = db.getSettings(userId)
          const projectLlm = conversation?.projectId && conversation.llmProvider === null
            ? db.getCiLlmConfig('project', conversation.projectId) ?? db.ciLlmDefaultsForUser(userId)
            : null
          effectiveEngine = conversation?.llmProvider ?? projectLlm?.provider ?? settings.llmProvider
        }
        if (execTarget === undefined) {
          const machine = db.resolveConversationMachine(userId, req.params.id)
          effectiveTarget = machine?.source === 'disabled' ? 'none' : machine?.agentId ?? null
        }
      }
      return db.addMessage(userId, req.params.id, role, text, time, effectiveEngine, meta, effectiveTarget, attachments, messageId)
    }
  )

  app.patch<{ Params: { id: string; messageId: string }; Body: { meta?: import('@voicechat/shared').TurnMeta } }>(
    '/api/conversations/:id/messages/:messageId',
    async (req, reply) => {
      if (!req.body?.meta) return reply.code(400).send({ error: 'meta required' })
      try {
        return db.updateMessageMeta(uid(req), req.params.id, req.params.messageId, req.body.meta)
      } catch {
        return reply.code(404).send({ error: 'not found' })
      }
    }
  )

  app.delete<{ Params: { id: string; messageId: string } }>(
    '/api/conversations/:id/messages/:messageId',
    async (req) => {
      db.deleteMessage(uid(req), req.params.id, req.params.messageId)
      // История изменилась — сбрасываем сессию Claude, чтобы следующий запрос
      // пересобрал контекст из БД (модель «забудет» удалённое).
      db.setClaudeSession(uid(req), req.params.id, null)
      return { ok: true }
    }
  )

  app.get(REST.mcpServers, async () => listMcpServers())

  app.get(REST.authStatus, async (req, reply) => {
    if (opts.authStatus) {
      try { return await opts.authStatus.get(uid(req)) }
      catch (err) { return proxyError(reply, err) }
    }
    if (!runnerFs) return getLoginStatus({ home: profile(req).home })
    try { return await runnerFs.authStatus(uid(req)) }
    catch (err) { return proxyError(reply, err) }
  })

  app.get(REST.ccProjects, async (req, reply) => {
    if (!runnerFs) return listProjects(ccDir(req))
    try {
      return await runnerFs.listCcProjects(uid(req))
    } catch (err) {
      return proxyError(reply, err)
    }
  })
  app.get<{ Params: { slug: string } }>(
    '/api/cc/projects/:slug/sessions',
    async (req, reply) => {
      if (!runnerFs) return listSessions(req.params.slug, ccDir(req))
      try {
        return await runnerFs.listCcSessions(uid(req), req.params.slug)
      } catch (err) {
        return proxyError(reply, err)
      }
    }
  )
  app.get<{ Params: { slug: string; id: string }; Querystring: { limit?: string } }>(
    '/api/cc/projects/:slug/sessions/:id',
    async (req, reply) => {
      if (!runnerFs) {
        const dir = ccDir(req)
        const items = readTranscript(req.params.slug, req.params.id, {
          limit: req.query.limit ? Number(req.query.limit) : undefined
        }, dir)
        return { items, usage: readUsage(req.params.slug, req.params.id, dir) }
      }
      try {
        return await runnerFs.readCcTranscript(uid(req), req.params.slug, req.params.id, req.query.limit ? Number(req.query.limit) : undefined)
      } catch (err) {
        return proxyError(reply, err)
      }
    }
  )

  app.post<{ Body: { slug: string; id: string } }>(REST.ccResume, async (req, reply) => {
    const u = uid(req)
    const { slug, id } = req.body ?? {}
    if (!slug || !id) return reply.code(400).send({ error: 'slug и id обязательны' })
    let items
    try {
      items = runnerFs
        ? (await runnerFs.readCcTranscript(u, slug, id)).items
        : readTranscript(slug, id, {}, ccDir(req))
    } catch (err) {
      return proxyError(reply, err)
    }
    const conv = db.createConversation(u, ccResumeTitle(items))
    const now = Date.now()
    for (const m of ccResumeMessages(items)) {
      db.addMessage(u, conv.id, m.role, m.text, ccTimeLabel(m.ts, now))
    }
    // Привязка к session-id CC → следующий ход пойдёт через `claude --resume <id>`.
    db.setClaudeSession(u, conv.id, id)
    return { conversation: db.getConversation(u, conv.id), messages: db.listMessages(u, conv.id) }
  })

  // --- Проводник Codex ---------------------------------------------------
  app.get(REST.cxProjects, async (req, reply) => {
    if (!runnerFs) return listCxProjects(cxDir(req))
    try {
      return await runnerFs.listCxProjects(uid(req))
    } catch (err) {
      return proxyError(reply, err)
    }
  })
  app.get<{ Querystring: { cwd?: string } }>(REST.cxSessions, async (req, reply) => {
    if (!runnerFs) return listCxSessions(req.query.cwd ?? '', cxDir(req))
    try {
      return await runnerFs.listCxSessions(uid(req), req.query.cwd ?? '')
    } catch (err) {
      return proxyError(reply, err)
    }
  })
  app.get<{ Querystring: { id?: string; limit?: string } }>(REST.cxTranscript, async (req, reply) => {
    if (!runnerFs) {
      const dir = cxDir(req)
      const id = req.query.id ?? ''
      const items = readCxTranscript(id, {
        limit: req.query.limit ? Number(req.query.limit) : undefined
      }, dir)
      return { items, usage: readCxUsage(id, dir) }
    }
    try {
      return await runnerFs.readCxTranscript(uid(req), req.query.id ?? '', req.query.limit ? Number(req.query.limit) : undefined)
    } catch (err) {
      return proxyError(reply, err)
    }
  })

  app.post<{ Body: { id: string } }>(REST.cxResume, async (req, reply) => {
    const u = uid(req)
    const { id } = req.body ?? {}
    if (!id) return reply.code(400).send({ error: 'id обязателен' })
    let items
    try {
      items = runnerFs
        ? (await runnerFs.readCxTranscript(u, id)).items
        : readCxTranscript(id, {}, cxDir(req))
    } catch (err) {
      return proxyError(reply, err)
    }
    const conv = db.createConversation(u, cxResumeTitle(items))
    const now = Date.now()
    for (const m of cxResumeMessages(items)) {
      db.addMessage(u, conv.id, m.role, m.text, cxTimeLabel(m.ts, now), m.role === 'ai' ? 'codex' : undefined)
    }
    // Привязка к session-id Codex (префикс провайдера) → следующий ход пойдёт
    // через `codex exec resume <id>` (см. resumeIdFor в session.ts).
    db.setClaudeSession(u, conv.id, `codex:${id}`)
    return { conversation: db.getConversation(u, conv.id), messages: db.listMessages(u, conv.id) }
  })

  app.get(REST.llmEngines, async (req) => db.listLlmEnginesForRole(db.getUser(uid(req))?.role ?? 'developer'))

  /**
   * Ссылки на машины живут в чужой таблице и могут исчезнуть мимо UI (удаление
   * другим сеансом, чистка). Отдавать висячий id нельзя: чат берёт его целью
   * выполнения и получает «машина не найдена», а в настройках он выглядит как
   * выбранная машина по умолчанию. Чиним лениво — на первом же чтении.
   */
  const settingsWithLiveAgents = (userId: string): Settings => {
    const settings = db.getSettings(userId)
    const alive = new Set(db.listAgents(userId).map((agent) => agent.id))
    const execTarget = settings.execTarget && !alive.has(settings.execTarget) ? null : settings.execTarget
    const defaultAgentId = settings.defaultAgentId && !alive.has(settings.defaultAgentId) ? null : settings.defaultAgentId
    if (execTarget === settings.execTarget && defaultAgentId === settings.defaultAgentId) return settings
    const repaired = { ...settings, execTarget, defaultAgentId }
    db.saveSettings(userId, repaired)
    return repaired
  }
  app.get(REST.settings, async (req) => settingsWithLiveAgents(uid(req)))
  const myLlmAccess = async (req: Parameters<typeof uid>[0]) => db.getUserLlmAccess(uid(req))
  app.get(REST.llmAccess, myLlmAccess)
  app.get(REST.meLlmAccess, myLlmAccess)

  // Личный отчёт строится всегда от uid сессии: query не содержит userId и не
  // может открыть расход другого пользователя.
  const usageForMe = (userId: string, query: { unit?: string; from?: string; to?: string; conversationId?: string }, reply: FastifyReply) => {
    const unit = query.unit ?? 'day'
    if (unit !== 'hour' && unit !== 'day' && unit !== 'week') return reply.code(400).send({ error: 'unit must be hour, day or week' })
    const number = (value: string | undefined): number | undefined => {
      if (value === undefined || value === '') return undefined
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    const from = number(query.from)
    const to = number(query.to)
    if ((query.from && from === undefined) || (query.to && to === undefined)) return reply.code(400).send({ error: 'from and to must be timestamps' })
    return db.usageReport(userId, unit as UsageUnit, from, to, query.conversationId || undefined)
  }
  app.get<{ Querystring: { unit?: string; from?: string; to?: string; conversationId?: string } }>(REST.usage, async (req, reply) => usageForMe(uid(req), req.query, reply))
  app.get<{ Querystring: { unit?: string; from?: string; to?: string; conversationId?: string } }>(REST.meUsage, async (req, reply) => usageForMe(uid(req), req.query, reply))

  // Свой профиль и свой журнал безопасности. Те же сведения, что админ видит о
  // человеке, но только о себе: имени в пути нет, оно берётся из сессии, поэтому
  // подставить чужое некуда. Роуты живут вне /api/admin/ — тот префикс целиком
  // закрыт привилегией users:manage.
  app.get(REST.meProfile, async (req): Promise<UserProfileInfo> => {
    const name = uid(req)
    const user = db.getUser(name)
    const agents = opts.liveAgents ? opts.liveAgents(db.listAgents(name)) : db.listAgents(name).map((agent) => ({ ...agent, online: opts.isAgentOnline?.(agent.id) ?? false }))
    const activity = db.sessionActivity().get(name)
    return {
      name,
      role: user?.role ?? 'observer',
      blocked: Boolean(user?.blocked),
      createdAt: user?.createdAt ?? 0,
      mustChangePassword: Boolean(user?.mustChangePassword),
      email: user?.email ?? null,
      lastLogin: user?.lastLogin ?? null,
      llmLimitUsd: user?.llmLimitUsd ?? null,
      conversationCount: db.conversationCounts().get(name) ?? 0,
      agents,
      lastSeenAt: activity?.lastSeen ?? null,
      liveSessions: activity?.live ?? 0
    }
  })
  app.get<{ Querystring: { limit?: string } }>(REST.meSecurity, async (req): Promise<SecurityEvent[]> => {
    const limit = Number(req.query.limit)
    return db.listSecurityEvents({ user: uid(req), limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 200 })
  })

  // Тело — патч, а не полная замена: неизвестные серверу поля не приходят, а
  // отсутствующие сохраняют прежнее значение. Это граница сохранности настроек —
  // клиент со старой сборкой (или не догрузивший настройки) больше не в силах
  // стереть чужие поля записи.
  app.put<{ Body: Partial<Settings> }>(REST.settings, async (req, reply) => {
    const role = db.getUser(uid(req))?.role ?? 'developer'
    // Патч сначала приводится к контракту: значение не того типа или не из
    // набора не должно осесть в записи (она мержится, и мусор остался бы навсегда).
    const patch = sanitizeSettingsPatch(req.body)
    if (patch.llmEngineId && !db.listLlmEnginesForRole(role).some((engine) => engine.id === patch.llmEngineId)) {
      return reply.code(403).send({ error: 'llm engine is not available for role' })
    }
    const generatedFilesTtlDays = patch.generatedFilesTtlDays ?? db.getSettings(uid(req)).generatedFilesTtlDays
    if (!Number.isInteger(generatedFilesTtlDays) || generatedFilesTtlDays < 1 || generatedFilesTtlDays > 3650) {
      return reply.code(400).send({ error: 'generatedFilesTtlDays must be an integer from 1 to 3650' })
    }
    const raw = patch.personalization ?? db.getSettings(uid(req)).personalization
    const preferredName = raw.preferredName?.trim().replace(/\s+/g, ' ') || null
    const currentYear = new Date().getUTCFullYear()
    const validParts =
      (raw.birthDay === null || (Number.isInteger(raw.birthDay) && raw.birthDay >= 1 && raw.birthDay <= 31)) &&
      (raw.birthMonth === null || (Number.isInteger(raw.birthMonth) && raw.birthMonth >= 1 && raw.birthMonth <= 12)) &&
      (raw.birthYear === null || (Number.isInteger(raw.birthYear) && raw.birthYear >= 1900 && raw.birthYear <= currentYear))
    const validDate = raw.birthDay === null || raw.birthMonth === null || raw.birthDay <= new Date(Date.UTC(raw.birthYear ?? 2000, raw.birthMonth, 0)).getUTCDate()
    const validEnums = (raw.responseLanguage === null || /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(raw.responseLanguage)) &&
      ['brief', 'normal', 'detailed', 'step-by-step'].includes(raw.responseStyle) &&
      ['neutral', 'friendly', 'business', 'plain'].includes(raw.tone)
    if (preferredName && preferredName.length > 80) return reply.code(400).send({ error: 'preferredName is too long' })
    if (!validParts || !validDate || !validEnums) return reply.code(400).send({ error: 'invalid personalization' })
    db.saveSettings(uid(req), { ...db.getSettings(uid(req)), ...patch, generatedFilesTtlDays, personalization: { ...raw, preferredName } })
    return settingsWithLiveAgents(uid(req))
  })
}
