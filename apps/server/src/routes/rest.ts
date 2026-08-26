// REST-роуты поверх VoiceChatDb (Ф3): разговоры, сообщения, настройки.

import { join } from 'node:path'
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
  instructionContextId,
  instructionText,
  isContextToggleable
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import { readUserFile } from '../serverFiles.js'
import { ensureCliProfile, listMcpServers } from '@voicechat/llm-runner/cli'
import { getLoginStatus } from '../auth/loginStatus.js'
import type { RunnerFsClient } from '../llm/runnerFsClient.js'
import type { ConversationContextSnapshot, ContextSnapshotGroup, ContextSnapshotItem, KbContextMode, PermissionMode } from '@voicechat/shared'

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
function contextSnapshot(db: VoiceChatDb, userId: string, conversationId: string, isOnline?: (id: string) => boolean): ConversationContextSnapshot | null {
  const conversation = db.getConversation(userId, conversationId)
  if (!conversation) return null
  // Тумблеры: пункт можно выключить (кроме безопасности/информации); выключенный
  // не считается включённым в следующий ход (includedInNextTurn=false).
  const disabled = new Set(conversation.disabledContext ?? [])
  const contextItem = (value: Omit<ContextSnapshotItem, 'toggleable' | 'enabled'>): ContextSnapshotItem => {
    const toggleable = isContextToggleable(value.id)
    const enabled = toggleable ? !disabled.has(value.id) : true
    return { ...value, toggleable, enabled, includedInNextTurn: value.includedInNextTurn && enabled }
  }
  const settings = db.getSettings(userId)
  const role = db.getUser(userId)?.role ?? 'developer'
  const resolution = db.resolveConversationMachine(userId, conversationId, { isOnline })
  const agent = resolution?.agentId ? db.listUsableAgents(userId, conversation.projectId).find((a) => a.id === resolution.agentId) : undefined
  const machineAvailable = Boolean(resolution?.agentId && !resolution.error)
  const project = conversation.projectId ? db.getProject(userId, conversation.projectId) : null
  const projectLlm = project && conversation.llmProvider === null
    ? db.getCiLlmConfig('project', project.id)
    : null
  const provider = conversation.llmProvider ?? projectLlm?.provider ?? settings.llmProvider
  const selectedModel = conversation.llmProvider === provider
    ? conversation.llmModel
    : (projectLlm?.provider === provider ? projectLlm.model : null)
  const model = selectedModel ?? (provider === 'codex' ? settings.codexModel : settings.model)
  const llmSource = conversation.llmProvider ? 'Разговор' : projectLlm ? 'Проект' : 'Настройки пользователя'
  const llmExplanation = conversation.llmProvider
    ? 'Явное переопределение.'
    : projectLlm
      ? 'Унаследовано из настроек проекта.'
      : 'Унаследовано из настроек пользователя.'
  const permissionMode: PermissionMode = conversation.execTarget === 'none' || (role !== 'admin' && !machineAvailable) ? 'plan' : (conversation.permissionMode ?? settings.permissionMode)
  const kbMode = conversation.kbContextMode ?? 'auto'
  const projectMachine = project?.machines.find((entry) => entry.agentId === resolution?.agentId)
  const workdir = conversation.workdir ?? projectMachine?.path ?? settings.workdir
  const messages = db.listMessages(userId, conversationId)
  const selectedSkills = new Set(conversation.skillNames)

  // Полная детализация для drill-in: те же данные и тот же текст, что реально
  // уходят в промпт (см. turns.ts) — чтобы «провалиться» и увидеть всё.
  const p = settings.personalization
  const styleLabel: Record<string, string> = { brief: 'кратко', detailed: 'подробно', 'step-by-step': 'пошагово', normal: 'обычно' }
  const toneLabel: Record<string, string> = { friendly: 'дружелюбный', business: 'деловой', plain: 'простой, без сложных терминов', neutral: 'нейтральный' }
  const personalizationLines = [
    p.preferredName ? `Обращение к пользователю: ${p.preferredName}.` : '',
    p.responseLanguage ? `Обычный язык ответа: ${p.responseLanguage}; явная просьба в текущем сообщении имеет приоритет.` : '',
    p.responseStyle !== 'normal' ? `Стиль ответа: ${styleLabel[p.responseStyle] ?? p.responseStyle}.` : '',
    p.tone !== 'neutral' ? `Тон общения: ${toneLabel[p.tone] ?? p.tone}.` : '',
    p.birthYear ? `Возраст пользователя учитывается (год рождения ${p.birthYear}).` : ''
  ].filter(Boolean)
  const personalizationDetails: Record<string, string | number | boolean | string[] | null> = {
    'Обращение': p.preferredName || '—',
    'Язык ответа': p.responseLanguage || '—',
    'Стиль': styleLabel[p.responseStyle] ?? p.responseStyle,
    'Тон': toneLabel[p.tone] ?? p.tone,
    'Дата рождения': p.birthYear ? `${String(p.birthDay ?? 1).padStart(2, '0')}.${String(p.birthMonth ?? 1).padStart(2, '0')}.${p.birthYear}` : '—',
    'Текст в промпте': personalizationLines.length ? personalizationLines.join('\n') : '(персонализация пуста — в промпт ничего не добавляется)'
  }
  const projectPromptLines = project
    ? [
        `ID проекта: ${project.id}`,
        project.gitUrl ? `Git-репозиторий: ${project.gitUrl}` : '',
        project.technologies.length ? `Технологии: ${project.technologies.join(', ')}` : '',
        project.skills.length ? `Навыки/области: ${project.skills.join(', ')}` : '',
        project.description ? project.description : ''
      ].filter(Boolean)
    : conversation.projectId ? [`ID проекта: ${conversation.projectId}`, 'Проект больше недоступен этому пользователю.'] : []
  const projectDetails: Record<string, string | number | boolean | string[] | null> = project
    ? {
        'ID проекта': project.id,
        'Git': project.gitUrl || '—',
        'Технологии': project.technologies.join(', ') || '—',
        'Навыки/области': project.skills.join(', ') || '—',
        'Описание': project.description || '—',
        'Текст в промпте': `## Контекст проекта «${project.name}»\n${projectPromptLines.join('\n')}`
      }
    : { 'Проект': 'Не выбран — проектный контекст в промпт не добавляется.' }
  // Конфиг/описание каждого MCP-инструмента для drill-in.
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
      contextItem({ id: 'personalization', type: 'Персонализация', source: 'Настройки пользователя', scope: 'Ответы пользователю', priority: '3 · пользователь', title: 'Предпочтения ответа', description: settings.personalization.responseLanguage || settings.personalization.responseStyle, explanation: 'Учитываются при сборке прикладных инструкций.', configured: Object.values(settings.personalization).some(Boolean), available: true, includedInNextTurn: Object.values(settings.personalization).some(Boolean), details: personalizationDetails })
    ] },
    { id: 'chat-instructions', order: 2, title: 'Инструкции чата', description: 'Подсказки из «Настройки → Инструкции»; здесь их можно выключить только для этого разговора.', items: settings.chatInstructions.map((item) => contextItem({
      id: instructionContextId(item.id), type: item.kind ? 'Встроенная инструкция' : 'Своя инструкция', source: 'Настройки пользователя', scope: 'Каждый ход', priority: '3 · инструкция чата',
      title: item.title, description: item.description || (item.kind ? 'Стандартная подсказка.' : 'Текст пользователя.'),
      explanation: item.enabled ? 'Включена в настройках; тумблер справа выключает её только в этом разговоре.' : 'Выключена в настройках пользователя — в ход не попадает независимо от тумблера.',
      configured: item.enabled, available: true, includedInNextTurn: item.enabled,
      details: { 'Вид': item.kind ?? 'своя', 'Текст': instructionText(item) }
    })) },
    { id: 'project', order: 3, title: 'Проект, директория и AGENTS.md', description: 'Эффективная рабочая область следующего хода.', items: [
      contextItem({ id: 'project-binding', type: 'Проект', source: 'Настройки разговора', scope: project?.name ?? 'Без проекта', priority: '4 · проект', title: project?.name ?? 'Проект не выбран', description: project ? 'Проект доступен пользователю.' : 'Привязка отсутствует.', explanation: project ? 'Явная привязка разговора.' : 'Проектный контекст не включён.', configured: Boolean(conversation.projectId), available: Boolean(project), includedInNextTurn: Boolean(project), details: projectDetails }),
      contextItem({ id: 'working-directory', type: 'Рабочая директория', source: conversation.workdir ? 'Разговор' : projectMachine ? 'Проект' : 'Настройки пользователя', scope: workdir ?? 'Не задана', priority: '5 · рабочая область', title: 'Рабочая директория', description: workdir ?? 'Каталог не настроен.', explanation: workdir && machineAvailable ? 'Передаётся исполнителю как cwd.' : 'Каталог нельзя проверить без доступной машины.', configured: Boolean(workdir), available: Boolean(workdir && machineAvailable), includedInNextTurn: Boolean(workdir) }),
      contextItem({ id: 'agents-chain', type: 'AGENTS.md', source: 'Рабочая директория', scope: workdir ?? 'Не определена', priority: '6 · от общей к конкретной', title: 'Цепочка AGENTS.md', description: workdir ? 'Фактическую цепочку разрешает исполнитель в рабочей директории.' : 'Без директории цепочка не определяется.', explanation: workdir && machineAvailable ? 'Текст скрыт: снимок не раскрывает файл без отдельного подтверждённого чтения.' : 'Директория или машина недоступна.', configured: Boolean(workdir), available: Boolean(workdir && machineAvailable), includedInNextTurn: Boolean(workdir && machineAvailable), details: { hiddenReason: 'Содержимое не читалось сервером инспектора.' } })
    ] },
    { id: 'conversation', order: 4, title: 'Настройки разговора', description: 'Эффективные значения с учётом наследования.', items: [
      contextItem({ id: 'llm', type: 'Настройка разговора', source: llmSource, scope: 'Следующий ход', priority: '7 · конфигурация', title: 'Модель и провайдер', description: `${provider} · ${model || 'модель из конфигурации CLI'}`, explanation: llmExplanation, configured: true, available: true, includedInNextTurn: true }),
      contextItem({ id: 'machine', type: 'Настройка разговора', source: resolution?.source === 'explicit' ? 'Разговор' : 'Резолвер сервера', scope: agent?.name ?? resolution?.agentId ?? 'Сервер', priority: '7 · конфигурация', title: 'Машина выполнения', description: agent?.name ?? 'Доступной машины нет', explanation: resolution?.error ? `Недоступна: ${resolution.error}.` : `Источник: ${resolution?.source ?? 'none'}.`, configured: conversation.execTarget !== null, available: machineAvailable, includedInNextTurn: machineAvailable }),
      contextItem({ id: 'permission-mode', type: 'Режим разрешений', source: conversation.permissionMode ? 'Разговор' : 'Эффективная политика сервера', scope: 'Инструменты и изменения', priority: '7 · конфигурация', title: permissionDisplay[permissionMode].displayName, description: permissionDisplay[permissionMode].explanation, explanation: permissionMode === 'plan' && conversation.permissionMode !== 'plan' ? 'Сервер безопасно форсировал режим.' : 'Выбранное или унаследованное значение.', configured: true, available: true, includedInNextTurn: true, details: { value: permissionMode } })
    ] },
    { id: 'skills', order: 5, title: 'Навыки', description: 'Выбор отделён от доступности и активации.', items: (agent?.policy.skills ?? []).map((skill) => contextItem({ id: `skill-${encodeURIComponent(skill.name)}`, type: 'Навык', source: 'Политика машины', scope: agent?.name ?? 'Машина', priority: '8 · навык', title: skill.name, description: skill.description || 'Инструкция навыка', explanation: selectedSkills.has(skill.name) ? 'Выбран; активация определяется текстом сообщения при отправке.' : 'Доступен, но не выбран.', configured: selectedSkills.has(skill.name), available: machineAvailable, includedInNextTurn: false, details: { activationReason: 'Текущее сообщение ещё не отправлено.' } })) },
    { id: 'capabilities', order: 6, title: 'MCP, приложения и плагины', description: 'Активный каталог вычислен сервером для текущего окружения.', items: [
      ...(['machines', 'read', 'edit', 'bash'] as const).map((name) => contextItem({ id: `mcp-remote-${name}`, type: 'MCP-инструмент', source: 'MCP remote', scope: agent?.name ?? 'Удалённая машина', priority: 'Возможность', title: `remote:${name}`, description: String(mcpToolDetails[`mcp-remote-${name}`]?.['Назначение'] ?? 'Инструмент удалённой машины.'), explanation: machineAvailable ? 'Подключается для эффективной машины.' : 'Машина недоступна.', configured: Boolean(resolution?.agentId), available: machineAvailable, includedInNextTurn: machineAvailable, details: mcpToolDetails[`mcp-remote-${name}`] })),
      ...(['search', 'document', 'topics'] as const).map((name) => contextItem({ id: `mcp-kb-${name}`, type: 'MCP-инструмент', source: 'MCP kb', scope: 'База знаний', priority: 'Возможность', title: `kb:${name}`, description: String(mcpToolDetails[`mcp-kb-${name}`]?.['Назначение'] ?? 'Инструмент базы знаний.'), explanation: kbMode === 'off' ? 'БЗ отключена.' : 'Подключается для выбранного режима.', configured: kbMode !== 'off', available: kbMode !== 'off', includedInNextTurn: kbMode !== 'off', details: mcpToolDetails[`mcp-kb-${name}`] }))
    ] },
    { id: 'knowledge', order: 7, title: 'База знаний', description: 'Режим и фактически подготовленный автоматический контекст.', items: [
      contextItem({ id: 'knowledge-mode', type: 'База знаний', source: 'Настройки разговора', scope: 'Следующий ход', priority: '9 · дополнительный контекст', title: kbDisplay[kbMode].displayName, description: kbDisplay[kbMode].explanation, explanation: kbMode === 'auto' ? 'Документы ещё не выбраны: текущее сообщение не отправлено.' : kbDisplay[kbMode].explanation, configured: kbMode !== 'off', available: kbMode !== 'off', includedInNextTurn: kbMode !== 'off', details: { value: kbMode, autoContextDocuments: [] } })
    ] },
    { id: 'history', order: 8, title: 'История и текущее сообщение', description: 'Серверные метаданные пользовательского контекста.', items: [
      contextItem({ id: 'conversation-history', type: 'История', source: 'Текущий разговор', scope: 'Следующий ход', priority: '10 · история', title: 'История разговора', description: `${messages.length} сообщений`, explanation: 'Сохранённая история передаётся при подготовке хода.', configured: messages.length > 0, available: true, includedInNextTurn: messages.length > 0, details: { messageCount: messages.length } }),
      contextItem({ id: 'current-message', type: 'Текущее сообщение', source: 'Поле ввода', scope: 'Следующий ход', priority: '11 · текущая задача', title: 'Текущее сообщение', description: 'Сообщение ещё не отправлено серверу.', explanation: 'Preview не считает будущий текст включённым.', configured: false, available: false, includedInNextTurn: false })
    ] }
  ]
  return { schemaVersion: 1, conversationId, generatedAt: new Date().toISOString(), freshnessWarning: 'Снимок отражает сохранённую конфигурацию на момент формирования. До отправки следующего сообщения настройки, доступность машин и контекст могут измениться.', summary: { provider, model, permissionMode: { value: permissionMode, ...permissionDisplay[permissionMode] }, kbMode: { value: kbMode, ...kbDisplay[kbMode] } }, groups }
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

export async function registerRest(
  app: FastifyInstance,
  db: VoiceChatDb,
  dataDir: string,
  opts: { runnerFs?: RunnerFsClient; authStatus?: AuthStatusState; isAgentOnline?: (agentId: string) => boolean } = {}
): Promise<void> {
  const profile = (req: Parameters<typeof uid>[0]) => ensureCliProfile(dataDir, uid(req))
  const ccDir = (req: Parameters<typeof uid>[0]) => process.env.VC_CC_DIR ?? profile(req).ccProjects
  const cxDir = (req: Parameters<typeof uid>[0]) => process.env.VC_CODEX_DIR ?? profile(req).codexSessions
  const runnerFs = opts.runnerFs
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
  app.get<{ Querystring: { includeCompleted?: string } }>(REST.conversations, async (req) =>
    db.listConversations(uid(req), { includeCompleted: queryFlag(req.query.includeCompleted) })
  )
   app.post<{ Body: DesktopMigrationBundle }>(REST.desktopMigration, async (req, reply) => {
    if (!req.body || !Array.isArray(req.body.conversations)) return reply.code(400).send({ error: 'invalid migration bundle' })
    return db.importDesktopData(uid(req), req.body)
  })

  app.post<{ Body: { title?: string; assistantKind?: 'web-recorder' | 'playwright-reader' | 'console-reader' } }>(REST.conversations, async (req) => {
    const kind = req.body?.assistantKind
    return db.createConversation(uid(req), req.body?.title, kind === 'web-recorder' || kind === 'playwright-reader' || kind === 'console-reader' ? kind : null)
  })

  app.get<{ Params: { projectId: string }; Querystring: { conversationId?: string } }>('/api/projects/:projectId/kanban-assistant', async (req, reply) => {
    const userId = uid(req)
    const privateConversation = db.ensureKanbanAssistantConversation(userId, req.params.projectId)
    const requested = req.query.conversationId ? db.getConversation(userId, req.query.conversationId) : null
    const conversation = requested?.projectId === req.params.projectId && (requested.assistantKind === null || requested.assistantKind === 'kanban')
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

  app.get<{ Querystring: { q?: string; includeCompleted?: string } }>(REST.conversationsSearch, async (req) =>
    db.searchConversations(uid(req), req.query.q ?? '', { includeCompleted: queryFlag(req.query.includeCompleted) })
  )

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

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    const conversation = db.getConversation(uid(req), req.params.id)
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    return { conversation, messages: db.listMessages(uid(req), req.params.id) }
  })

  app.get<{ Params: { id: string } }>('/api/conversations/:id/context-snapshot', async (req, reply) => {
    const snapshot = contextSnapshot(db, uid(req), req.params.id, opts.isAgentOnline)
    if (!snapshot) return reply.code(404).send({ error: 'not found' })
    return snapshot
  })
  // Включить/выключить пункт контекста: выключенный не попадает ассистенту в
  // следующих ходах (turns.ts). Правила безопасности сервер выключить не даёт.
  app.post<{ Params: { id: string; itemId: string }; Body: { enabled?: boolean } }>('/api/conversations/:id/context/:itemId', async (req, reply) => {
    if (!isContextToggleable(req.params.itemId)) return reply.code(400).send({ error: 'Этот пункт нельзя выключить' })
    const updated = db.setConversationContextEnabled(uid(req), req.params.id, req.params.itemId, req.body?.enabled !== false)
    if (!updated) return reply.code(404).send({ error: 'not found' })
    const snapshot = contextSnapshot(db, uid(req), req.params.id, opts.isAgentOnline)
    return snapshot ?? reply.code(404).send({ error: 'not found' })
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
      const { role, text, time, engine, meta, execTarget, attachments } = req.body
      return db.addMessage(uid(req), req.params.id, role, text, time, engine, meta, execTarget, attachments)
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

  app.get(REST.settings, async (req) => db.getSettings(uid(req)))
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

  app.put<{ Body: Settings }>(REST.settings, async (req, reply) => {
    const role = db.getUser(uid(req))?.role ?? 'developer'
    if (req.body.llmEngineId && !db.listLlmEnginesForRole(role).some((engine) => engine.id === req.body.llmEngineId)) {
      return reply.code(403).send({ error: 'llm engine is not available for role' })
    }
    const generatedFilesTtlDays = req.body.generatedFilesTtlDays ?? db.getSettings(uid(req)).generatedFilesTtlDays
    if (!Number.isInteger(generatedFilesTtlDays) || generatedFilesTtlDays < 1 || generatedFilesTtlDays > 3650) {
      return reply.code(400).send({ error: 'generatedFilesTtlDays must be an integer from 1 to 3650' })
    }
    const raw = req.body.personalization ?? db.getSettings(uid(req)).personalization
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
    db.saveSettings(uid(req), { ...req.body, generatedFilesTtlDays, personalization: { ...raw, preferredName } })
    return db.getSettings(uid(req))
  })
}
