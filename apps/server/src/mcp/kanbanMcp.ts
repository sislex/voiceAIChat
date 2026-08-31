// MCP-эндпоинт канбан-ассистента: инструменты `mcp__kanban__*` читают и меняют
// проект того разговора, в котором идёт ход. Устроен по образцу makeMcp:
// stateless (свежий сервер на POST), доступ по секрету процесса `k`, разговор —
// query `conv`, ход — query `turn`, режим «План» — `ro=1`.
//
// Почему инструменты, а не JSON-envelope прежнего адаптера: ассистенту канбана
// нужен тот же цикл «прочитал состояние → изменил → увидел результат», что у
// Make и Консоли. Envelope `propose.*` остаётся только для режима подтверждений.
//
// Границы безопасности те же, что у прежнего шлюза виджетов: URL из запроса нет,
// произвольного HTTP нет, разрешены только перечисленные здесь операции и только
// в проекте разговора; права проверяет тот же `db.*`, что и REST.

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createHash } from 'node:crypto'
import {
  STRONG_SIMILARITY,
  canTransitionWorkflow,
  isAllowedWidgetRoute,
  isAssistantRunnableCommand,
  issueKey,
  pickCiRunAgent,
  queryWidgetItems,
  rankSimilarTasks,
  MAX_ACTIVE_ORCHESTRATIONS,
  orchestrationPlanError,
  taskWidgetItem,
  type KanbanColumnSemanticType,
  type Task,
  type WidgetAssistantAutonomy
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { AgentRegistry } from '../agents/registry.js'
import type { WidgetContextStore } from './widgetContext.js'
import type { Orchestration, OrchestrationItemInput } from '@voicechat/shared'
import type { WidgetUiRelay } from './widgetUiRelay.js'

export const KANBAN_MCP_PATH = '/mcp/kanban'

/**
 * Запуск работ ассистентом идёт через те же менеджеры, что и кнопки в UI:
 * дублировать логику очередей, изоляции директорий и проверок готовности мы не
 * имеем права. Ленивый геттер — потому что менеджеры создаются позже MCP.
 */
export interface KanbanRunLaunchers {
  /** Тестовое окружение фичи (feature-preview): те же операции, что у кнопок панели. */
  previewOperate?(userId: string, projectId: string, taskId: string, operation: 'start' | 'rebuild' | 'stop' | 'seed' | 'reset' | 'health_check', options: { scenario?: string; agentId?: string }): Promise<unknown>
  /** Подготовка задачи (уточняющие вопросы и критерии) — тот же запуск, что у кнопки вкладки. */
  startPreparation?(userId: string, projectId: string, taskId: string): { id: string; status: string }
  /** Релизная ветка и выкладка в production; и то, и другое — только с подтверждением. */
  createReleaseBranch?(userId: string, projectId: string, branch: string, baseBranch?: string): Promise<{ id?: string; branch?: string; status?: string }>
  deployRelease?(userId: string, projectId: string, branch: string): Promise<{ id?: string; status?: string }>
  startCi(userId: string, projectId: string, taskId: string, options: { launch: 'queue' | 'parallel'; agentId?: string }): { run: { id: string; status: string; agentId: string | null } } | { error: string }
  cancelCi(userId: string, runId: string): boolean
  startMerge(userId: string, projectId: string, taskId: string, agentId: string | null): Promise<{ id: string; status: string }>
  startQa(userId: string, projectId: string, taskId: string, stage: 'component_qa' | 'integration_tests' | 'automated_qa'): Promise<{ id: string; status: string }>
}

export interface KanbanMcpDeps {
  db: VoiceChatDb
  /** Онлайн-статус и телеметрия машин; в тестах не обязателен. */
  agents?: Pick<AgentRegistry, 'isOnline' | 'telemetryOf' | 'nameOf'>
  contexts: WidgetContextStore
  /** Мост в браузер пользователя: навигация, кнопки и запрос подтверждения. */
  ui?: WidgetUiRelay
  /** Доска изменилась — разослать снимок открытым клиентам. */
  boardChanged?: (projectId: string) => void
  /** Менеджеры ранов; читается при вызове инструмента, а не при регистрации. */
  runs?: () => KanbanRunLaunchers | undefined
  /** Фоновый исполнитель планов; тоже ленивый — создаётся позже MCP. */
  orchestration?: () => { track(planId: string): Promise<void>; cancel(owner: string, planId: string): Orchestration | null } | undefined
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

export const toolText = (t: string, isError = false): ToolResult =>
  isError ? { content: [{ type: 'text', text: t }], isError: true } : { content: [{ type: 'text', text: t }] }

export const toolJson = (value: unknown): ToolResult => toolText(JSON.stringify(value, null, 2))

/** Кто и в каком проекте работает: разговор — единственный источник и того, и другого. */
export interface KanbanScope {
  userId: string
  projectId: string
  conversationId: string
}

export function resolveKanbanScope(db: VoiceChatDb, conversationId: string): KanbanScope | null {
  const userId = db.conversationOwner(conversationId)
  if (!userId) return null
  const conversation = db.getConversation(userId, conversationId)
  if (!conversation?.projectId) return null
  // Инструменты канбана живут в приватном разговоре ассистента и в обычных
  // чатах проекта; специализированные поверхности (make, console) сюда не ходят.
  if (conversation.assistantKind && conversation.assistantKind !== 'kanban') return null
  return { userId, projectId: conversation.projectId, conversationId }
}

/**
 * Убирает undefined из аргументов инструмента: у методов БД поля опциональные, а
 * явный undefined в объекте под `exactOptionalPropertyTypes` — это не «поле не
 * передано», а «передано undefined».
 */
export function dropUndefined<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> }
}

/** Компактная проекция карточки: полный Task на сотню задач не влезает в контекст. */
export function taskBrief(task: Task, projectName: string, columnName: string): Record<string, unknown> {
  return {
    id: task.id,
    key: issueKey(projectName, task),
    title: task.title,
    type: task.type,
    column: columnName,
    columnId: task.columnId,
    priority: task.priority,
    assignee: task.assignee,
    agentId: task.agentId ?? null,
    labels: task.labels,
    skills: task.skills,
    flagged: task.flagged,
    autoPilot: task.autoPilot ?? false,
    parentId: task.parentId,
    storyPoints: task.storyPoints,
    dueDate: task.dueDate,
    updatedAt: task.updatedAt
  }
}

/**
 * Где задача в конвейере с точки зрения «можно ли начинать пересекающуюся
 * работу». `done_not_merged` — самый опасный случай: карточка выглядит
 * завершённой, но её ветка ещё не в основной, и новая работа над тем же кодом
 * почти наверняка получит конфликт.
 */
export type TaskPipelineState = 'planned' | 'in_progress' | 'awaiting_merge' | 'done_not_merged' | 'merged' | 'cancelled'

export function taskPipelineState(
  semanticType: KanbanColumnSemanticType | undefined,
  mergeStatuses: string[]
): TaskPipelineState {
  const merged = mergeStatuses.includes('success')
  if (semanticType === 'cancelled') return 'cancelled'
  if (semanticType === 'done') return merged ? 'merged' : 'done_not_merged'
  if (semanticType === 'awaiting_merge' || semanticType === 'merge') return 'awaiting_merge'
  if (semanticType === 'backlog' || semanticType === 'preparation' || semanticType === 'ready' || semanticType === undefined) return 'planned'
  return 'in_progress'
}

/** Состояния, из-за которых пересекающуюся задачу лучше подождать, а не начинать. */
export const BLOCKING_PIPELINE_STATES: readonly TaskPipelineState[] = ['in_progress', 'awaiting_merge', 'done_not_merged']

/**
 * Тестовые учётные записи проекта — это пароли. Канбан-ассистенту они не нужны
 * ни для одной операции, а в историю чата попали бы навсегда; логины оставляем,
 * чтобы он мог сказать, под какими ролями проверяется фича.
 */
export function safeProject<T extends { testUsers?: Array<{ password?: string }> } | null>(project: T): T {
  if (!project?.testUsers) return project
  return { ...project, testUsers: project.testUsers.map(({ password: _password, ...rest }) => rest) }
}

/** Ключи чтения проектного API: белый список вместо произвольного HTTP. */
export const PROJECT_READ_KEYS = [
  'project', 'members', 'machines', 'columns', 'board_view', 'invitations',
  'ci_commands', 'ci_llm', 'ci_settings', 'releases',
  'task', 'task_timeline', 'task_ci_runs', 'task_merge_runs', 'task_preparation_runs',
  'task_repositories', 'task_improvements', 'task_qa_runs'
] as const
export type ProjectReadKey = (typeof PROJECT_READ_KEYS)[number]

/**
 * Идемпотентность вызовов инструментов. Модель не передаёт ключ сама, поэтому
 * он выводится из хода и аргументов: повтор после таймаута или обрыва потока
 * не должен заводить вторую такую же карточку или второй ран. Кэш процессный —
 * как у прежнего шлюза виджетов; переживать рестарт ему незачем, потому что
 * ход после рестарта всё равно начинается заново.
 */
export function toolCallKey(conversationId: string, turnId: string, tool: string, args: unknown): string {
  return createHash('sha1').update([conversationId, turnId, tool, JSON.stringify(args ?? null)].join('\u0000')).digest('hex')
}

const IDEMPOTENCY_CAP = 2_000

export function registerKanbanMcp(app: FastifyInstance, deps: KanbanMcpDeps, secret: string): void {
  const idempotency = new Map<string, ToolResult>()
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', (_req, _payload, done) => done(null, undefined))
    scope.post<{ Querystring: { conv?: string; k?: string; turn?: string; ro?: string } }>(
      KANBAN_MCP_PATH,
      async (req, reply) => {
        if (req.query.k !== secret) return reply.code(403).send({ error: 'forbidden' })
        const conv = req.query.conv ?? ''
        const found = resolveKanbanScope(deps.db, conv)
        if (!found) return reply.code(404).send({ error: 'conversation not found' })
        const { db, agents, contexts, ui, boardChanged } = deps
        const { userId, projectId } = found
        const readOnly = req.query.ro === '1'
        // Автономия хранится на разговоре: пользователь переключает её тумблером
        // «Автопилот» в шапке ассистента, а не глобальной настройкой.
        const autonomy: WidgetAssistantAutonomy = db.getConversation(userId, conv)?.assistantAutonomy ?? 'auto'

        const project = (): ReturnType<VoiceChatDb['getProject']> => db.getProject(userId, projectId)
        const projectName = (): string => project()?.name ?? 'Проект'
        const board = (includeCompleted = true): ReturnType<VoiceChatDb['getBoard']> =>
          db.getBoard(userId, projectId, { includeCompleted })
        const columnName = (columnId: string): string =>
          board()?.columns.find((column) => column.id === columnId)?.name ?? '—'
        const revision = (tasks: Task[]): string => String(Math.max(0, ...tasks.map((task) => task.updatedAt)))

        const planBlocked = (): ToolResult =>
          toolText('Отклонено: режим «План» — проект менять нельзя. Исследуй чтением (kanban_board, kanban_task_get); изменения начнутся после одобрения плана.', true)

        /**
         * Единственная точка политики изменений. Необратимое наружу (деплой,
         * удаление) спрашивается всегда — даже в режиме полной автономии; в
         * режиме подтверждений спрашивается любое изменение.
         */
        const allowMutation = async (
          title: string,
          rows: Array<{ field: string; before?: unknown; after?: unknown }>,
          opts: { irreversible?: boolean; note?: string } = {}
        ): Promise<{ ok: true } | { ok: false; result: ToolResult }> => {
          if (readOnly) return { ok: false, result: planBlocked() }
          if (autonomy === 'auto' && !opts.irreversible) return { ok: true }
          if (!ui) return { ok: false, result: toolText('Нужно подтверждение пользователя, но мост интерфейса недоступен.', true) }
          const outcome = await ui.request(userId, conv, projectId, { kind: 'confirm', title, rows, ...(opts.note ? { note: opts.note } : {}) })
          if (!outcome.ok) return { ok: false, result: toolText(outcome.error ?? 'Подтверждение не получено.', true) }
          if (outcome.result?.confirmed !== true) return { ok: false, result: toolText('Пользователь отклонил действие.', true) }
          return { ok: true }
        }

        const applied = (projectIdToEmit: string, payload: unknown): ToolResult => {
          boardChanged?.(projectIdToEmit)
          return toolJson(payload)
        }

        /**
         * Обёртка изменяющего инструмента: идемпотентность по ходу и аргументам
         * плюс запись в runtime-log. Аудит здесь, а не в каждом инструменте:
         * при автономном режиме «кто это сделал» спрашивают про любое действие,
         * а не про заранее выбранные.
         */
        const mutating = async (tool: string, args: unknown, run: () => Promise<ToolResult>): Promise<ToolResult> => {
          const key = toolCallKey(conv, req.query.turn ?? '', tool, args)
          const replay = idempotency.get(key)
          if (replay) {
            req.log.info({ event: 'kanban.tool', tool, userId, projectId, conversationId: conv, replayed: true }, 'kanban tool replayed')
            return { ...replay, content: [...replay.content, { type: 'text', text: 'Повтор того же вызова в этом ходе: действие уже выполнено, результат прежний.' }] }
          }
          const result = await run()
          req.log.info({
            event: 'kanban.tool',
            tool,
            userId,
            projectId,
            conversationId: conv,
            turnId: req.query.turn ?? null,
            autonomy,
            readOnly,
            ok: !result.isError,
            args
          }, 'kanban tool call')
          // Отказ не кэшируем: он мог быть отказом пользователя, и следующая
          // попытка с тем же аргументом — это новый вопрос, а не повтор.
          if (!result.isError) {
            idempotency.set(key, result)
            if (idempotency.size > IDEMPOTENCY_CAP) idempotency.delete(idempotency.keys().next().value as string)
          }
          return result
        }

        const uiAction = async (action: Parameters<WidgetUiRelay['request']>[3]): Promise<ToolResult> => {
          if (!ui) return toolText('Мост интерфейса недоступен: приложение пользователя не подключено.', true)
          const outcome = await ui.request(userId, conv, projectId, action)
          if (!outcome.ok) return toolText(outcome.error ?? 'Действие в интерфейсе не выполнено.', true)
          // Снимок после действия — источник правды о том, что теперь на экране.
          if (outcome.result?.surface) contexts.updateSurface(conv, outcome.result.surface)
          return toolJson(outcome.result ?? { surface: null })
        }

        const server = new McpServer({ name: 'kanban', version: '1.0.0' })

        server.registerTool('kanban_context', {
          description: 'Что сейчас открыто у пользователя: раздел страницы проекта (доска/настройки/релизы), адрес, открытая карточка и вкладка, вид доски и кнопки, которые можно нажать. Начинай с него: ответ про доску, когда пользователь смотрит настройки, почти всегда мимо.',
          inputSchema: {}
        }, async () => {
          const detail = project()
          const snapshot = board()
          const surface = contexts.surface(conv)
          return toolJson({
            project: detail ? { id: detail.id, name: detail.name, description: detail.description, technologies: detail.technologies, skills: detail.skills } : null,
            conversationId: conv,
            surface,
            board: snapshot ? { columns: snapshot.columns.length, tasks: snapshot.tasks.length, revision: revision(snapshot.tasks) } : null
          })
        })

        server.registerTool('kanban_board', {
          description: 'Доска проекта: колонки с их местом в workflow (semanticType) и карточки в компактном виде. Полное содержимое карточки — kanban_task_get.',
          inputSchema: {
            includeCompleted: z.boolean().optional().describe('Включать завершённые карточки (по умолчанию да)'),
            columnId: z.string().optional().describe('Только карточки этой колонки'),
            limit: z.number().int().min(1).max(500).optional().describe('Максимум карточек в ответе (по умолчанию 200)')
          }
        }, async (args) => {
          const snapshot = board(args.includeCompleted !== false)
          if (!snapshot) return toolText('Доска недоступна: проект не найден или нет доступа.', true)
          const name = projectName()
          const byColumn = new Map(snapshot.columns.map((column) => [column.id, column.name]))
          const tasks = snapshot.tasks
            .filter((task) => !args.columnId || task.columnId === args.columnId)
            .slice(0, args.limit ?? 200)
            .map((task) => taskBrief(task, name, byColumn.get(task.columnId) ?? '—'))
          return toolJson({
            revision: revision(snapshot.tasks),
            columns: snapshot.columns.map((column) => ({
              id: column.id,
              name: column.name,
              semanticType: column.semanticType,
              hidden: column.hidden,
              wipLimit: column.wipLimit,
              tasks: snapshot.tasks.filter((task) => task.columnId === column.id).length
            })),
            total: snapshot.tasks.length,
            tasks
          })
        })

        server.registerTool('kanban_task_get', {
          description: 'Карточка целиком: описание, критерии приёмки, подзадачи, а также сводка процессов — CI-раны разработки, merge-раны, QA-этапы и подготовка. По ней видно, сделана ли задача и вмержена ли она.',
          inputSchema: { taskId: z.string().describe('id карточки (не ключ вида PRJ-42)') }
        }, async (args) => {
          const task = db.getTaskDetail(userId, projectId, args.taskId)
          if (!task) return toolText('Карточка не найдена в этом проекте.', true)
          const snapshot = board()
          const name = projectName()
          const children = (snapshot?.tasks ?? []).filter((item) => item.parentId === task.id)
          return toolJson({
            task: { ...task, key: issueKey(name, task), column: columnName(task.columnId) },
            children: children.map((child) => taskBrief(child, name, columnName(child.columnId))),
            ci: db.listCiRunsForTask(userId, projectId, task.id).slice(0, 5).map((run) => ({ id: run.id, status: run.status, mode: run.mode, agentId: run.agentId, error: run.error, startedAt: run.startedAt, finishedAt: run.finishedAt })),
            merge: db.listMergeRuns(userId, projectId, task.id, 5).map((run) => ({ id: run.id, status: run.status, error: run.error, startedAt: run.startedAt, finishedAt: run.finishedAt })),
            preparation: db.listTaskPreparationRuns(userId, projectId, task.id).slice(0, 3).map((run) => ({ id: run.id, status: run.status })),
            repositories: db.listTaskRepositories(userId, projectId, task.id)
          })
        })

        server.registerTool('kanban_search_tasks', {
          description: 'Поиск карточек по тексту заголовка и содержимого. Возвращает компактные карточки; используй перед созданием новой задачи и когда пользователь называет задачу словами, а не ключом.',
          inputSchema: {
            text: z.string().optional().describe('Искомый текст'),
            kinds: z.array(z.string()).optional().describe('Типы элементов: task, story, epic'),
            limit: z.number().int().min(1).max(100).optional()
          }
        }, async (args) => {
          const snapshot = board()
          if (!snapshot) return toolText('Доска недоступна.', true)
          const name = projectName()
          const items = queryWidgetItems(snapshot.tasks.map(taskWidgetItem), args.text ?? '', args.kinds ?? [], args.limit ?? 30)
          const byId = new Map(snapshot.tasks.map((task) => [task.id, task]))
          return toolJson({
            revision: revision(snapshot.tasks),
            found: items.length,
            tasks: items.map((item) => taskBrief(byId.get(item.id)!, name, columnName(byId.get(item.id)!.columnId)))
          })
        })

        server.registerTool('project_info', {
          description: 'Проект целиком: тип, технологии, навыки, участники и их роли, машины проекта с загрузкой и онлайн-статусом, настройки CI и автопрохода. Отсюда берётся ответ на «что за проект» и «куда запускать работу».',
          inputSchema: {}
        }, async () => {
          const detail = project()
          if (!detail) return toolText('Проект недоступен.', true)
          const load = db.countActiveCiRunsByAgent()
          return toolJson({
            id: detail.id,
            name: detail.name,
            description: detail.description,
            technologies: detail.technologies,
            skills: detail.skills,
            typeChain: detail.typeChain,
            role: detail.role,
            baseBranch: detail.ciBaseBranch ?? null,
            automatedQaCommand: detail.automatedQaCommand ?? null,
            autoPilotRequiresManualQa: detail.autoPilotRequiresManualQa ?? null,
            autoPilotFixLimit: detail.autoPilotFixLimit ?? null,
            defaultAgentId: detail.defaultAgentId,
            members: detail.members.map((member) => ({ username: member.username, role: member.role, active: member.active !== false })),
            machines: detail.machines.map((machine) => ({
              agentId: machine.agentId,
              name: machine.name,
              online: agents ? agents.isOnline(machine.agentId) : machine.online === true,
              canUse: machine.canUse !== false,
              isDefault: machine.agentId === detail.defaultAgentId,
              activeRuns: load[machine.agentId] ?? 0,
              ready: machine.readiness?.ready ?? null,
              readinessReasons: machine.readiness?.reasons ?? []
            }))
          })
        })

        server.registerTool('project_api_get', {
          description: `Чтение остального проектного API одним инструментом. Доступные ключи: ${PROJECT_READ_KEYS.join(', ')}. Ключи, начинающиеся на task_, требуют taskId.`,
          inputSchema: {
            key: z.enum(PROJECT_READ_KEYS).describe('Что прочитать'),
            taskId: z.string().optional().describe('Карточка для ключей task_*'),
            id: z.string().optional().describe('Идентификатор для точечных чтений (например релиз)'),
            stage: z.enum(['component_qa', 'integration_tests', 'automated_qa']).optional().describe('Этап для task_qa_runs')
          }
        }, async (args) => {
          const key = args.key as ProjectReadKey
          const needsTask = key.startsWith('task')
          if (needsTask && !args.taskId) return toolText('Для этого ключа нужен taskId.', true)
          const taskId = args.taskId ?? ''
          switch (key) {
            case 'project': return toolJson(safeProject(project()))
            case 'members': return toolJson(project()?.members ?? [])
            case 'machines': return toolJson(project()?.machines ?? [])
            case 'columns': return toolJson(board()?.columns ?? [])
            case 'board_view': return toolJson(db.getBoardView(userId, projectId))
            case 'invitations': return toolJson(db.listProjectInvitations(userId, projectId) ?? [])
            case 'ci_commands': return toolJson(db.listCiCommands(userId, projectId))
            case 'ci_llm': return toolJson(db.getCiLlmConfig('project', projectId))
            case 'ci_settings': return toolJson(db.getCiSettings())
            case 'releases': return toolJson(args.id ? db.getProjectRelease(userId, projectId, args.id) : db.listProjectReleases(userId, projectId))
            case 'task': return toolJson(db.getTaskDetail(userId, projectId, taskId))
            case 'task_timeline': return toolJson(db.taskTimeline(userId, projectId, taskId))
            case 'task_ci_runs': return toolJson(db.listCiRunsForTask(userId, projectId, taskId))
            case 'task_merge_runs': return toolJson(db.listMergeRuns(userId, projectId, taskId))
            case 'task_preparation_runs': return toolJson(db.listTaskPreparationRuns(userId, projectId, taskId))
            case 'task_repositories': return toolJson(db.listTaskRepositories(userId, projectId, taskId))
            case 'task_improvements': return toolJson(db.listTaskImprovements(userId, projectId, taskId))
            case 'task_qa_runs': return toolJson(db.listQaStageRuns(userId, projectId, taskId, args.stage ?? 'automated_qa'))
            default: return toolText('Неизвестный ключ чтения.', true)
          }
        })

        /** Похожие задачи со статусом в конвейере — общая часть поиска и создания. */
        const similarTasks = (query: { id?: string; title: string; description?: string; acceptanceCriteria?: string; labels?: string[]; skills?: string[] }, limit = 5) => {
          const snapshot = board()
          if (!snapshot) return []
          const semanticById = new Map(snapshot.columns.map((column) => [column.id, column.semanticType]))
          const byId = new Map(snapshot.tasks.map((task) => [task.id, task]))
          return rankSimilarTasks({ id: query.id ?? 'new', ...query }, snapshot.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            acceptanceCriteria: task.acceptanceCriteria,
            labels: task.labels,
            skills: task.skills
          })), limit).map((hit) => {
            const task = byId.get(hit.id)!
            const mergeStatuses = db.listMergeRuns(userId, projectId, task.id, 5).map((run) => run.status)
            const state = taskPipelineState(semanticById.get(task.columnId), mergeStatuses)
            return {
              id: task.id,
              key: issueKey(projectName(), task),
              title: task.title,
              column: columnName(task.columnId),
              score: Number(hit.score.toFixed(2)),
              overlap: hit.overlap,
              state,
              // «Блокирует» не значит «нельзя»: значит, что новую работу над тем
              // же местом честнее начинать после merge этой карточки.
              blocking: BLOCKING_PIPELINE_STATES.includes(state) && hit.score >= STRONG_SIMILARITY
            }
          })
        }

        server.registerTool('kanban_find_similar', {
          description: 'Найти уже существующие задачи, пересекающиеся с описанием новой. Для каждой возвращает место в конвейере: planned, in_progress, awaiting_merge, done_not_merged (сделана, но ветка не влита), merged, cancelled — и признак blocking. Вызывай перед созданием задачи и когда пользователь просит «взять в работу» что-то похожее.',
          inputSchema: {
            title: z.string().min(1),
            description: z.string().optional(),
            acceptanceCriteria: z.string().optional(),
            labels: z.array(z.string()).optional(),
            skills: z.array(z.string()).optional(),
            limit: z.number().int().min(1).max(20).optional()
          }
        }, async (args) => {
          const { limit, ...query } = args
          const hits = similarTasks(dropUndefined(query) as { title: string }, limit ?? 5)
          return toolJson({
            found: hits.length,
            strongThreshold: STRONG_SIMILARITY,
            hits,
            advice: hits.some((hit) => hit.blocking)
              ? 'Есть пересекающаяся незавершённая работа: объясни пользователю разницу или предложи дождаться merge, прежде чем начинать новую.'
              : 'Явных пересечений нет.'
          })
        })

        server.registerTool('machines_load', {
          description: 'Загрузка машин проекта: онлайн, число активных ранов, готовность и рекомендация, куда запускать следующий ран. Смотри перед запуском работы, чтобы не свалить всё на одну машину.',
          inputSchema: {}
        }, async () => {
          const detail = project()
          if (!detail) return toolText('Проект недоступен.', true)
          const load = db.countActiveCiRunsByAgent()
          const usable = detail.machines.filter((machine) => machine.canUse !== false && (agents ? agents.isOnline(machine.agentId) : machine.online === true))
          const recommended = pickCiRunAgent(usable.map((machine) => machine.agentId), detail.defaultAgentId, load)
          return toolJson({
            machines: detail.machines.map((machine) => ({
              agentId: machine.agentId,
              name: machine.name,
              online: agents ? agents.isOnline(machine.agentId) : machine.online === true,
              canUse: machine.canUse !== false,
              isDefault: machine.agentId === detail.defaultAgentId,
              activeRuns: load[machine.agentId] ?? 0,
              ready: machine.readiness?.ready ?? null,
              telemetry: agents?.telemetryOf(machine.agentId) ?? null
            })),
            recommended,
            reason: recommended
              ? (load[recommended] ?? 0) === 0
                ? 'Машина свободна от активных ранов.'
                : 'Все машины заняты — выбрана наименее загруженная.'
              : 'Доступных online-машин нет: запускать работу некуда.'
          })
        })

        // --- Изменения доски -------------------------------------------

        const TASK_FIELDS = {
          description: z.string().optional(),
          acceptanceCriteria: z.string().optional(),
          type: z.enum(['epic', 'story', 'task']).optional(),
          parentId: z.string().nullable().optional(),
          priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
          assignee: z.string().nullable().optional().describe('Логин участника проекта или null'),
          agentId: z.string().nullable().optional().describe('Машина для CI; null — машина проекта по умолчанию'),
          labels: z.array(z.string()).optional(),
          skills: z.array(z.string()).optional(),
          storyPoints: z.number().nullable().optional(),
          dueDate: z.number().nullable().optional(),
          flagged: z.boolean().optional(),
          autoPilot: z.boolean().optional().describe('Карточка сама проходит development и QA-конвейер')
        }

        server.registerTool('kanban_task_create', {
          description: 'Создать карточку. Перед созданием ОБЯЗАТЕЛЬНО проверь дубликаты (kanban_search_tasks): заводить вторую задачу про то же — худшее, что может сделать ассистент. columnId по умолчанию — первая колонка доски (бэклог).',
          inputSchema: {
            title: z.string().min(1).describe('Заголовок карточки'),
            columnId: z.string().optional().describe('Колонка; по умолчанию первая на доске'),
            acknowledgeSimilar: z.boolean().optional().describe('Похожие задачи проверены и задача всё равно нужна'),
            ...TASK_FIELDS
          }
        }, async (args) => mutating('kanban_task_create', args, async () => {
          const snapshot = board()
          if (!snapshot) return toolText('Доска недоступна.', true)
          const column = args.columnId ?? snapshot.columns[0]?.id
          if (!column) return toolText('На доске нет колонок: сначала создай колонку.', true)
          // Предупреждение о дубликате возвращается вместо создания: модель
          // обязана объяснить разницу и повторить вызов с acknowledgeSimilar.
          const similar = similarTasks(dropUndefined({ title: args.title, description: args.description, acceptanceCriteria: args.acceptanceCriteria, labels: args.labels, skills: args.skills }) as { title: string })
          const blocking = similar.filter((hit) => hit.blocking)
          if (blocking.length && !args.acknowledgeSimilar) {
            return toolJson({
              created: null,
              blockedBySimilar: blocking,
              advice: 'Похожая незавершённая работа уже есть. Объясни пользователю разницу или предложи дождаться merge; если задача действительно другая, повтори вызов с acknowledgeSimilar: true.'
            })
          }
          const gate = await allowMutation('Создать карточку', [{ field: 'title', after: args.title }, { field: 'columnId', after: column }])
          if (!gate.ok) return gate.result
          try {
            const { columnId: _ignored, acknowledgeSimilar: _ack, title, ...rest } = args
            const created = db.createTask(userId, projectId, { ...dropUndefined(rest), columnId: column, title })
            if (!created) return toolText('Создать карточку не удалось: нет доступа к проекту.', true)
            return applied(projectId, { created: taskBrief(created, projectName(), columnName(created.columnId)) })
          } catch (error) { return toolText(error instanceof Error ? error.message : String(error), true) }
        }))

        server.registerTool('kanban_task_update', {
          description: 'Изменить поля карточки. Передавай только те поля, которые меняешь.',
          inputSchema: { taskId: z.string(), title: z.string().optional(), ...TASK_FIELDS }
        }, async (args) => mutating('kanban_task_update', args, async () => {
          const { taskId, ...patch } = args
          const current = db.getTaskDetail(userId, projectId, taskId)
          if (!current) return toolText('Карточка не найдена в этом проекте.', true)
          const rows = Object.entries(patch)
            .filter(([, value]) => value !== undefined)
            .map(([field, after]) => ({ field, before: (current as unknown as Record<string, unknown>)[field], after }))
          if (!rows.length) return toolText('Нечего менять: не передано ни одного поля.', true)
          const gate = await allowMutation(`Изменить ${issueKey(projectName(), current)}`, rows)
          if (!gate.ok) return gate.result
          try {
            const updated = db.updateTask(userId, projectId, taskId, dropUndefined(patch))
            if (!updated) return toolText('Изменить карточку не удалось.', true)
            return applied(projectId, { updated: taskBrief(updated, projectName(), columnName(updated.columnId)) })
          } catch (error) { return toolText(error instanceof Error ? error.message : String(error), true) }
        }))

        server.registerTool('kanban_task_move', {
          description: 'Переместить карточку в другую колонку (или внутри колонки). Переходы по QA-конвейеру ограничены: из development можно в component_qa или decision_required, но не сразу в done.',
          inputSchema: {
            taskId: z.string(),
            columnId: z.string().describe('Колонка назначения'),
            afterId: z.string().nullable().optional().describe('Поставить после этой карточки'),
            beforeId: z.string().nullable().optional().describe('Поставить перед этой карточкой')
          }
        }, async (args) => mutating('kanban_task_move', args, async () => {
          const snapshot = board()
          const current = snapshot?.tasks.find((task) => task.id === args.taskId)
          if (!snapshot || !current) return toolText('Карточка не найдена в этом проекте.', true)
          const from = snapshot.columns.find((column) => column.id === current.columnId)
          const to = snapshot.columns.find((column) => column.id === args.columnId)
          if (!to) return toolText('Колонка назначения не найдена.', true)
          // Пользователь на доске тоже ограничен картой переходов — ассистент
          // не должен иметь права, которого нет у человека.
          if (from && from.id !== to.id && !canTransitionWorkflow(from.semanticType, to.semanticType, 'user')) {
            return toolText(`Переход ${from.semanticType} → ${to.semanticType} запрещён картой workflow.`, true)
          }
          const gate = await allowMutation(`Перенести ${issueKey(projectName(), current)}`, [{ field: 'column', before: from?.name, after: to.name }])
          if (!gate.ok) return gate.result
          const moved = db.moveTask(userId, projectId, args.taskId, { columnId: args.columnId, afterId: args.afterId ?? null, beforeId: args.beforeId ?? null })
          if (!moved) return toolText('Перенести карточку не удалось.', true)
          return applied(projectId, { moved: taskBrief(moved, projectName(), columnName(moved.columnId)) })
        }))

        server.registerTool('kanban_column_create', {
          description: 'Создать колонку доски.',
          inputSchema: { name: z.string().min(1) }
        }, async (args) => mutating('kanban_column_create', args, async () => {
          const gate = await allowMutation('Создать колонку', [{ field: 'name', after: args.name }])
          if (!gate.ok) return gate.result
          const created = db.createColumn(userId, projectId, args.name)
          if (!created) return toolText('Создать колонку не удалось.', true)
          return applied(projectId, { created })
        }))

        server.registerTool('kanban_column_update', {
          description: 'Переименовать колонку, задать WIP-лимит или скрыть её с доски.',
          inputSchema: {
            columnId: z.string(),
            name: z.string().optional(),
            wipLimit: z.number().int().nullable().optional(),
            hidden: z.boolean().optional()
          }
        }, async (args) => mutating('kanban_column_update', args, async () => {
          const column = board()?.columns.find((item) => item.id === args.columnId)
          if (!column) return toolText('Колонка не найдена.', true)
          const rows = [
            ...(args.name !== undefined ? [{ field: 'name', before: column.name, after: args.name }] : []),
            ...(args.wipLimit !== undefined ? [{ field: 'wipLimit', before: column.wipLimit, after: args.wipLimit }] : []),
            ...(args.hidden !== undefined ? [{ field: 'hidden', before: column.hidden, after: args.hidden }] : [])
          ]
          if (!rows.length) return toolText('Нечего менять.', true)
          const gate = await allowMutation(`Изменить колонку «${column.name}»`, rows)
          if (!gate.ok) return gate.result
          if (args.name !== undefined || args.wipLimit !== undefined) {
            db.updateColumn(userId, projectId, args.columnId, {
              ...(args.name !== undefined ? { name: args.name } : {}),
              ...(args.wipLimit !== undefined ? { wipLimit: args.wipLimit } : {})
            })
          }
          if (args.hidden !== undefined) db.setColumnHidden(userId, projectId, args.columnId, args.hidden)
          return applied(projectId, { column: board()?.columns.find((item) => item.id === args.columnId) ?? null })
        }))

        server.registerTool('project_settings_update', {
          description: 'Изменить настройки проекта: имя, описание, технологии, навыки, базовую ветку, команду Automated QA и параметры автопрохода. Остальные настройки меняет владелец руками.',
          inputSchema: {
            name: z.string().optional(),
            description: z.string().optional(),
            technologies: z.array(z.string()).optional(),
            skills: z.array(z.string()).optional(),
            ciBaseBranch: z.string().optional(),
            automatedQaCommand: z.string().optional(),
            autoPilotRequiresManualQa: z.boolean().optional(),
            autoPilotFixLimit: z.number().int().min(0).optional()
          }
        }, async (args) => mutating('project_settings_update', args, async () => {
          const detail = project()
          if (!detail) return toolText('Проект недоступен.', true)
          const rows = Object.entries(args)
            .filter(([, value]) => value !== undefined)
            .map(([field, after]) => ({ field, before: (detail as unknown as Record<string, unknown>)[field], after }))
          if (!rows.length) return toolText('Нечего менять.', true)
          // Настройки проекта видны всей команде — спрашиваем всегда.
          const gate = await allowMutation('Изменить настройки проекта', rows, { irreversible: true })
          if (!gate.ok) return gate.result
          const updated = db.updateProject(userId, projectId, dropUndefined(args))
          if (!updated) return toolText('Изменить настройки не удалось: нужны права владельца.', true)
          return applied(projectId, { updated: { name: updated.name, description: updated.description, ciBaseBranch: updated.ciBaseBranch ?? null } })
        }))

        // --- Запуск работ ----------------------------------------------

        const launchers = (): KanbanRunLaunchers | null => deps.runs?.() ?? null

        server.registerTool('run_ci_start', {
          description: 'Запустить разработку задачи (CI-ран). launch=queue ставит в общую очередь проекта, launch=parallel запускает сразу мимо лимита параллельных ранов. Машину выбирай по machines_load, если карточка не закреплена за конкретной.',
          inputSchema: {
            taskId: z.string(),
            launch: z.enum(['queue', 'parallel']).optional().describe('По умолчанию queue'),
            agentId: z.string().optional().describe('Машина проекта; по умолчанию — машина карточки или проекта')
          }
        }, async (args) => mutating('run_ci_start', args, async () => {
          const runner = launchers()
          if (!runner) return toolText('Запуск ранов сейчас недоступен.', true)
          const task = db.getTaskDetail(userId, projectId, args.taskId)
          if (!task) return toolText('Карточка не найдена в этом проекте.', true)
          const gate = await allowMutation(`Запустить разработку ${issueKey(projectName(), task)}`, [
            { field: 'launch', after: args.launch ?? 'queue' },
            { field: 'agentId', after: args.agentId ?? task.agentId ?? 'машина проекта' }
          ])
          if (!gate.ok) return gate.result
          const started = runner.startCi(userId, projectId, args.taskId, { launch: args.launch ?? 'queue', ...(args.agentId ? { agentId: args.agentId } : {}) })
          if ('error' in started) return toolText(started.error, true)
          return applied(projectId, { run: started.run, link: `/projects/${projectId}/task/${args.taskId}` })
        }))

        server.registerTool('run_ci_cancel', {
          description: 'Отменить CI-ран по его id.',
          inputSchema: { runId: z.string() }
        }, async (args) => mutating('run_ci_cancel', args, async () => {
          const runner = launchers()
          if (!runner) return toolText('Управление ранами сейчас недоступно.', true)
          const gate = await allowMutation('Отменить CI-ран', [{ field: 'runId', after: args.runId }])
          if (!gate.ok) return gate.result
          return runner.cancelCi(userId, args.runId)
            ? applied(projectId, { cancelled: args.runId })
            : toolText('Отменить ран не удалось: он уже завершён или недоступен.', true)
        }))

        server.registerTool('run_merge_start', {
          description: 'Запустить merge-ран: слияние ветки задачи в основную с проверками. Делай это только для задачи, дошедшей до awaiting_merge.',
          inputSchema: { taskId: z.string(), agentId: z.string().optional() }
        }, async (args) => mutating('run_merge_start', args, async () => {
          const runner = launchers()
          if (!runner) return toolText('Merge-раны сейчас недоступны.', true)
          const task = db.getTaskDetail(userId, projectId, args.taskId)
          if (!task) return toolText('Карточка не найдена в этом проекте.', true)
          // Слияние в основную ветку видно всей команде — спрашиваем всегда.
          const gate = await allowMutation(`Влить ${issueKey(projectName(), task)} в основную ветку`, [{ field: 'task', after: task.title }], { irreversible: true })
          if (!gate.ok) return gate.result
          try {
            const run = await runner.startMerge(userId, projectId, args.taskId, args.agentId ?? null)
            return applied(projectId, { run })
          } catch (error) { return toolText(error instanceof Error ? error.message : String(error), true) }
        }))

        server.registerTool('run_qa_start', {
          description: 'Запустить этап проверки задачи: component_qa, integration_tests или automated_qa. Так поднимается тестовое окружение и прогоняются тесты соответствующего этапа.',
          inputSchema: {
            taskId: z.string(),
            stage: z.enum(['component_qa', 'integration_tests', 'automated_qa'])
          }
        }, async (args) => mutating('run_qa_start', args, async () => {
          const runner = launchers()
          if (!runner) return toolText('QA-раны сейчас недоступны.', true)
          const task = db.getTaskDetail(userId, projectId, args.taskId)
          if (!task) return toolText('Карточка не найдена в этом проекте.', true)
          const gate = await allowMutation(`Запустить ${args.stage} для ${issueKey(projectName(), task)}`, [{ field: 'stage', after: args.stage }])
          if (!gate.ok) return gate.result
          try {
            const run = await runner.startQa(userId, projectId, args.taskId, args.stage)
            return applied(projectId, { run })
          } catch (error) { return toolText(error instanceof Error ? error.message : String(error), true) }
        }))

        server.registerTool('preview_start', {
          description: 'Тестовое окружение задачи (feature-preview): поднять (start), пересобрать (rebuild), остановить (stop), засеять данными (seed), сбросить (reset) или проверить здоровье (health_check). Так пользователь видит фичу вживую до merge.',
          inputSchema: {
            taskId: z.string(),
            operation: z.enum(['start', 'rebuild', 'stop', 'seed', 'reset', 'health_check']).optional().describe('По умолчанию start'),
            scenario: z.string().optional().describe('Сценарий тестовых данных для seed'),
            agentId: z.string().optional()
          }
        }, async (args) => mutating('preview_start', args, async () => {
          const runner = launchers()
          if (!runner?.previewOperate) return toolText('Тестовые окружения сейчас недоступны.', true)
          const task = db.getTaskDetail(userId, projectId, args.taskId)
          if (!task) return toolText('Карточка не найдена в этом проекте.', true)
          const operation = args.operation ?? 'start'
          const gate = await allowMutation(`Окружение ${issueKey(projectName(), task)}: ${operation}`, [{ field: 'operation', after: operation }])
          if (!gate.ok) return gate.result
          try {
            const environment = await runner.previewOperate(userId, projectId, args.taskId, operation, dropUndefined({ scenario: args.scenario, agentId: args.agentId }))
            return applied(projectId, { environment })
          } catch (error) { return toolText(error instanceof Error ? error.message : String(error), true) }
        }))

        server.registerTool('run_preparation_start', {
          description: 'Запустить подготовку задачи: модель уточняет постановку и предлагает критерии приёмки. Делай это до разработки, если у карточки пустое описание или расплывчатые критерии.',
          inputSchema: { taskId: z.string() }
        }, async (args) => mutating('run_preparation_start', args, async () => {
          const runner = launchers()
          if (!runner?.startPreparation) return toolText('Подготовка задач сейчас недоступна.', true)
          const task = db.getTaskDetail(userId, projectId, args.taskId)
          if (!task) return toolText('Карточка не найдена в этом проекте.', true)
          const gate = await allowMutation(`Запустить подготовку ${issueKey(projectName(), task)}`, [{ field: 'task', after: task.title }])
          if (!gate.ok) return gate.result
          try {
            return applied(projectId, { run: runner.startPreparation(userId, projectId, args.taskId) })
          } catch (error) { return toolText(error instanceof Error ? error.message : String(error), true) }
        }))

        server.registerTool('project_machine_update', {
          description: 'Машины проекта: link — привязать машину, unlink — отвязать, default — сделать машиной проекта по умолчанию. Меняет настройку, видимую всей команде, поэтому спрашивается подтверждение.',
          inputSchema: {
            action: z.enum(['link', 'unlink', 'default']),
            agentId: z.string(),
            storageId: z.string().optional().describe('Хранилище машины при привязке')
          }
        }, async (args) => mutating('project_machine_update', args, async () => {
          const gate = await allowMutation('Изменить машины проекта', [
            { field: 'action', after: args.action },
            { field: 'agentId', after: args.agentId }
          ], { irreversible: true })
          if (!gate.ok) return gate.result
          const detail = args.action === 'link'
            ? db.linkMachine(userId, projectId, args.agentId, args.storageId)
            : args.action === 'unlink'
              ? db.unlinkMachine(userId, projectId, args.agentId)
              : db.setProjectDefaultMachine(userId, projectId, args.agentId)
          if (!detail) return toolText('Изменить машины не удалось: нет прав или машина недоступна.', true)
          return applied(projectId, { machines: detail.machines.map((machine) => ({ agentId: machine.agentId, name: machine.name, isDefault: machine.agentId === detail.defaultAgentId })) })
        }))

        server.registerTool('release_create_branch', {
          description: 'Создать релизную ветку от базовой. Первый шаг выпуска; сама по себе выкладку не делает.',
          inputSchema: { branch: z.string().min(1).describe('Имя релизной ветки, например release/1.4.0'), baseBranch: z.string().optional() }
        }, async (args) => mutating('release_create_branch', args, async () => {
          // Права проверяются раньше доступности механизма: отказ по правам не
          // должен зависеть от того, настроены ли релизы в этом окружении.
          if (!db.isProjectOwner(userId, projectId)) return toolText('Релизами управляет владелец проекта.', true)
          const runner = launchers()
          if (!runner?.createReleaseBranch) return toolText('Релизы сейчас недоступны.', true)
          const gate = await allowMutation('Создать релизную ветку', [{ field: 'branch', after: args.branch }], { irreversible: true })
          if (!gate.ok) return gate.result
          try {
            return toolJson({ release: await runner.createReleaseBranch(userId, projectId, args.branch, args.baseBranch) })
          } catch (error) { return toolText(error instanceof Error ? error.message : String(error), true) }
        }))

        server.registerTool('release_deploy', {
          description: 'Выложить релизную ветку в production. Необратимое действие наружу: подтверждение спрашивается всегда, даже в режиме автопилота.',
          inputSchema: { branch: z.string().min(1) }
        }, async (args) => mutating('release_deploy', args, async () => {
          if (!db.isProjectOwner(userId, projectId)) return toolText('Выкладкой в production управляет владелец проекта.', true)
          const runner = launchers()
          if (!runner?.deployRelease) return toolText('Выкладка сейчас недоступна.', true)
          const gate = await allowMutation('Выложить релиз в production', [{ field: 'branch', after: args.branch }], {
            irreversible: true,
            note: 'Это выкладка в production — она видна пользователям сразу.'
          })
          if (!gate.ok) return gate.result
          try {
            return toolJson({ deploy: await runner.deployRelease(userId, projectId, args.branch) })
          } catch (error) { return toolText(error instanceof Error ? error.message : String(error), true) }
        }))

        // --- Оркестрация: план работ, который ассистент ведёт сам -------

        const PLAN_ITEMS = z.array(z.object({
          kind: z.enum(['create_task', 'run_ci', 'run_qa', 'run_merge', 'wait_merge', 'run_preview']),
          title: z.string().min(1).describe('Что делает шаг — это увидит пользователь'),
          taskId: z.string().optional().describe('Задача шага; не нужен, если шаг зависит от create_task'),
          dependsOn: z.array(z.number().int().min(0)).optional().describe('Индексы шагов этого плана (с нуля), которые должны завершиться раньше'),
          payload: z.record(z.string(), z.unknown()).optional().describe('create_task: title/description/acceptanceCriteria/columnId/autoPilot; run_ci: launch/agentId; run_qa: stage; run_preview: operation/scenario; любой шаг: retries (0–3) — сколько раз перезапустить после падения')
        })).min(1).max(40)

        const planSummary = (plan: Orchestration): unknown => ({
          id: plan.id,
          title: plan.title,
          status: plan.status,
          error: plan.error,
          items: plan.items.map((item) => ({ position: item.position, kind: item.kind, title: item.title, status: item.status, taskId: item.taskId, runId: item.runId, error: item.error }))
        })

        server.registerTool('orchestration_plan', {
          description: 'Проверить план работ, не запуская его: связность зависимостей, наличие задач у шагов. Показывай результат пользователю перед orchestration_start.',
          inputSchema: { title: z.string().min(1), items: PLAN_ITEMS }
        }, async (args) => {
          const error = orchestrationPlanError(args.items as OrchestrationItemInput[])
          return error
            ? toolText(`План некорректен: ${error}`, true)
            : toolJson({ valid: true, title: args.title, steps: args.items.length, items: args.items })
        })

        server.registerTool('orchestration_start', {
          description: 'Запустить план работ: сервер сам создаст задачи, запустит разработку и проверки, дождётся merge и продолжит — план переживает закрытие вкладки и рестарт. Шаг wait_merge держит зависящие шаги, пока ветка задачи не влита: так пересекающиеся задачи не идут одновременно. Итог плана придёт сообщением в этот чат.',
          inputSchema: { title: z.string().min(1), items: PLAN_ITEMS }
        }, async (args) => mutating('orchestration_start', args, async () => {
          const manager = deps.orchestration?.()
          if (!manager) return toolText('Оркестратор сейчас недоступен.', true)
          const invalid = orchestrationPlanError(args.items as OrchestrationItemInput[])
          if (invalid) return toolText(`План некорректен: ${invalid}`, true)
          // Планы идут параллельно и каждый занимает машины: три одновременных
          // — предел, дальше пользователь перестаёт понимать, что происходит.
          if (db.countActiveOrchestrations(userId, projectId) >= MAX_ACTIVE_ORCHESTRATIONS) {
            return toolText(`В проекте уже идёт ${MAX_ACTIVE_ORCHESTRATIONS} плана: дождись их завершения или останови лишний (orchestration_cancel).`, true)
          }
          const gate = await allowMutation(`Запустить план «${args.title}»`, args.items.map((item, index) => ({ field: `${index + 1}. ${item.kind}`, after: item.title })), { irreversible: true })
          if (!gate.ok) return gate.result
          const plan = db.createOrchestration(userId, projectId, conv, args.title, args.items as OrchestrationItemInput[])
          if (!plan) return toolText('Создать план не удалось: нет доступа к проекту.', true)
          // Первый проход выполняется здесь же: ассистент отвечает пользователю
          // уже начатым планом, а не «поставил в очередь, посмотрим потом».
          await manager.track(plan.id)
          return toolJson({ started: planSummary(db.getOrchestrationById(plan.id) ?? plan) })
        }))

        server.registerTool('orchestration_status', {
          description: 'Состояние планов проекта: без planId — последние планы, с planId — один план по шагам.',
          inputSchema: { planId: z.string().optional() }
        }, async (args) => {
          if (args.planId) {
            const plan = db.getOrchestration(userId, args.planId)
            return plan ? toolJson(planSummary(plan)) : toolText('План не найден.', true)
          }
          return toolJson({ plans: db.listOrchestrations(userId, projectId).map(planSummary) })
        })

        server.registerTool('orchestration_cancel', {
          description: 'Остановить план: незавершённые шаги отменяются, уже запущенные раны продолжают идти сами.',
          inputSchema: { planId: z.string() }
        }, async (args) => mutating('orchestration_cancel', args, async () => {
          const manager = deps.orchestration?.()
          if (!manager) return toolText('Оркестратор сейчас недоступен.', true)
          const cancelled = manager.cancel(userId, args.planId)
          return cancelled ? toolJson({ cancelled: planSummary(cancelled) }) : toolText('План не найден.', true)
        }))

        // --- Интерфейс пользователя ------------------------------------

        server.registerTool('ui_state', {
          description: 'Прочитать живое состояние экрана пользователя: адрес, раздел, открытая карточка и список кнопок, которые сейчас можно нажать (id для ui_run_command).',
          inputSchema: {}
        }, async () => uiAction({ kind: 'read-state' }))

        server.registerTool('ui_navigate', {
          description: 'Открыть у пользователя ссылку внутри проекта: /projects/<id>, /projects/<id>/settings, /projects/<id>/releases, /projects/<id>/task/<taskId>, а также /kb. Так ты показываешь то, о чём говоришь, вместо инструкции «нажмите там-то».',
          inputSchema: { route: z.string().describe('Путь без #, например /projects/p1/settings') }
        }, async (args) => {
          if (!isAllowedWidgetRoute(args.route, projectId)) return toolText('Этот адрес вне текущего проекта — навигация запрещена.', true)
          return uiAction({ kind: 'navigate', route: args.route.replace(/^#/, '') })
        })

        server.registerTool('ui_run_command', {
          description: 'Нажать кнопку приложения по её id из ui_state (командная палитра ⌘K). Работают только команды, доступные на текущем экране.',
          inputSchema: { commandId: z.string() }
        }, async (args) => {
          // Часть команд палитры обходит политику подтверждений (выход из
          // аккаунта), поэтому ассистенту они закрыты — на сервере и в браузере.
          if (!isAssistantRunnableCommand(args.commandId)) return toolText('Эту кнопку ассистенту нажимать нельзя — попроси пользователя сделать это самому.', true)
          return uiAction({ kind: 'run-command', commandId: args.commandId })
        })

        server.registerTool('ui_open_task', {
          description: 'Открыть карточку задачи у пользователя, при необходимости на конкретной вкладке (preparation, chat).',
          inputSchema: { taskId: z.string(), tab: z.string().optional() }
        }, async (args) => uiAction({ kind: 'open-task', taskId: args.taskId, ...(args.tab ? { tab: args.tab } : {}) }))

        server.registerTool('ui_close_task', {
          description: 'Закрыть открытую карточку и вернуть пользователя на доску.',
          inputSchema: {}
        }, async () => uiAction({ kind: 'close-task' }))

        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
        reply.raw.on('close', () => { void transport.close(); void server.close() })
        await server.connect(transport)
        await transport.handleRequest(req.raw, reply.raw, req.body)
      }
    )
  })
}
