import type { KanbanColumn, ProjectSummary, Task } from './projects'
import type { Settings } from './types'

/** Widget-neutral, secret-free snapshot supplied to an assistant. */
export interface WidgetAssistantContext<TSelection = unknown> {
  version: 1
  widget: { kind: string; instanceId: string; title: string }
  /** Тип нужен ассистенту по той же причине, что и модели хода: без него он
   *  предлагает действия выключенных подсистем. */
  project: Pick<ProjectSummary, 'id' | 'name' | 'description' | 'technologies' | 'skills' | 'typeChain'> | null
  selection: TSelection | null
  /** Что сейчас открыто на экране: без этого ассистент рассуждает о доске,
   *  когда пользователь смотрит настройки или релизы. */
  surface?: WidgetSurfaceSnapshot | null
  /** Результат read-only шлюза для текущей реплики; не сохраняется в истории. */
  toolResults?: { query?: WidgetToolQueryResult }
  recentActions: WidgetUserAction[]
}

/** Раздел страницы проекта. Совпадает с секциями `ProjectPage` плюс page-ассистент. */
export type WidgetSurfaceSection = 'board' | 'settings' | 'releases' | 'assistant'

/** Кнопка, которую можно нажать прямо сейчас: пункт реестра командной палитры. */
export interface WidgetSurfaceCommand {
  id: string
  title: string
  section: string
  hint?: string
}

/** Снимок экрана пользователя: адрес, раздел, открытая карточка и доступные кнопки. */
export interface WidgetSurfaceSnapshot {
  /** Полный hash-маршрут без «#», например `/projects/p1/task/t2/preparation`. */
  route: string
  section: WidgetSurfaceSection
  openTaskId: string | null
  /** Вкладка открытой карточки (`preparation`, `chat`, …) или null. */
  openTaskTab: string | null
  /** Настройки просмотра доски — по ним видно, почему карточки не видно на экране. */
  boardView: { showCompleted: boolean; swimlaneBy: string | null; search: string | null } | null
  commands: WidgetSurfaceCommand[]
}

/** Действие ассистента в интерфейсе пользователя (мост «сервер → браузер → результат»). */
export type WidgetUiAction =
  | { kind: 'read-state' }
  | { kind: 'navigate'; route: string }
  | { kind: 'run-command'; commandId: string }
  | { kind: 'open-task'; taskId: string; tab?: string }
  | { kind: 'close-task' }
  /** Спросить пользователя перед необратимым действием; ответ — `confirmed`. */
  | { kind: 'confirm'; title: string; note?: string; rows: Array<{ field: string; before?: unknown; after?: unknown }> }

export interface WidgetUiActionResult {
  surface: WidgetSurfaceSnapshot | null
  note?: string
  confirmed?: boolean
}

export type WidgetUiActionOutcome =
  | { ok: true; result?: WidgetUiActionResult }
  | { ok: false; error: string }

/** Режим применения мутаций: `auto` — сразу, `confirm` — через карточку подтверждения. */
export type WidgetAssistantAutonomy = 'auto' | 'confirm'

/** Разделы вне проекта, куда ассистенту можно уводить пользователя. */
const SHARED_ROUTE_PREFIXES = ['/kb']

/**
 * Навигация ограничена своим проектом и общей базой знаний: иначе ассистент
 * одного проекта уводил бы пользователя в чужие данные и в админку.
 */
export function isAllowedWidgetRoute(route: string, projectId: string): boolean {
  const clean = route.replace(/^#/, '')
  if (!clean.startsWith('/') || clean.includes('..')) return false
  const own = `/projects/${projectId}`
  if (clean === own || clean.startsWith(`${own}/`)) return true
  return SHARED_ROUTE_PREFIXES.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`))
}

export interface WidgetUserAction {
  id: string
  kind: string
  label: string
  at: number
  targetId?: string
}

/** Adapter implemented by kanban today and explorer/console/browser later. */
export interface WidgetAssistantAdapter<TSelection = unknown> {
  getContext: () => WidgetAssistantContext<TSelection>
  execute: (command: WidgetAssistantCommand) => void | Promise<void>
}

export type SupportedTaskPatch = Partial<Pick<Task,
  'title' | 'description' | 'acceptanceCriteria' | 'type' | 'parentId' | 'priority' |
  'assignee' | 'agentId' | 'labels' | 'skills' | 'storyPoints' | 'dueDate' | 'flagged' | 'columnId'
>>

/** Поля создания ровно соответствуют форме новой карточки канбана. */
export type WidgetTaskCreate = Pick<Task, 'columnId' | 'title'> & Partial<Pick<Task,
  'description' | 'acceptanceCriteria' | 'type' | 'parentId' | 'priority' | 'assignee' |
  'agentId' | 'labels' | 'skills' | 'storyPoints' | 'dueDate'
>>

export type SupportedSettingPatch = Partial<Pick<Settings,
  'model' | 'llmProvider' | 'codexModel' | 'llmEngineId' | 'aiAssistProvider' | 'aiAssistModel' |
  'permissionMode' | 'theme' | 'autoSpeak' | 'showConsole'
>>

export type WidgetAssistantCommand =
  | { type: 'navigate.project-settings'; projectId: string }
  | { type: 'navigate.task'; projectId: string; taskId: string }
  | { type: 'propose.task-create'; projectId: string; input: WidgetTaskCreate; reason?: string }
  | { type: 'propose.task-update'; projectId: string; taskId: string; patch: SupportedTaskPatch; reason?: string }
  | { type: 'propose.rephrase'; projectId: string; taskId: string; field: 'title' | 'description' | 'acceptanceCriteria'; value: string; reason?: string }
  | { type: 'propose.acceptance-criteria'; projectId: string; taskId: string; value: string; reason?: string }
  | { type: 'propose.settings-update'; patch: SupportedSettingPatch; reason?: string }

export interface KanbanAssistantSelection {
  /** Семантический UI-снимок: шлюз использует его раньше серверного fallback. */
  board: { projectId: string; columns: KanbanColumn[]; tasks: Task[]; revision: string }
  openTask: Task | null
  selectedField: keyof SupportedTaskPatch | null
}

export const WIDGET_TOOL_CONTRACT_VERSION = 1 as const
export type WidgetToolOperation = 'describe' | 'query' | 'get' | 'action'

export interface WidgetToolScope {
  version: typeof WIDGET_TOOL_CONTRACT_VERSION
  widgetKind: string
  widgetInstanceId: string
  projectId: string
  conversationId: string
  /** id сообщения текущего хода; сервер проверяет принадлежность разговору. */
  turnId: string
}

export interface WidgetToolItem {
  id: string
  kind: string
  title: string
  version: string
  data: Record<string, unknown>
}

export interface WidgetToolDescription {
  version: typeof WIDGET_TOOL_CONTRACT_VERSION
  widgetKind: string
  capabilities: Array<{ operation: WidgetToolOperation; name: string; confirmation: 'never' | 'required' }>
}

export interface WidgetToolQueryRequest extends WidgetToolScope {
  text?: string
  kinds?: string[]
  limit?: number
  /** Доверенный UI передаёт только семантические элементы текущего экземпляра. */
  ui?: { revision: string; items: WidgetToolItem[] }
}

export interface WidgetToolQueryResult {
  source: 'ui' | 'api'
  revision: string
  items: WidgetToolItem[]
}

export interface WidgetToolGetRequest extends WidgetToolScope { itemId: string }
export interface WidgetToolGetResult { revision: string; item: WidgetToolItem }

export type WidgetToolAction =
  | { name: 'kanban.task.update'; taskId: string; expectedVersion: string; patch: SupportedTaskPatch }
  | { name: 'kanban.task.create'; input: WidgetTaskCreate }

export interface WidgetToolActionRequest extends WidgetToolScope {
  action: WidgetToolAction
  confirmation: { confirmed: true; proposalId: string }
  idempotencyKey: string
}

export interface WidgetToolActionResult {
  applied: boolean
  replayed: boolean
  revision: string
  item?: WidgetToolItem
}

export function taskWidgetItem(task: Task): WidgetToolItem {
  return { id: task.id, kind: task.type, title: task.title, version: String(task.updatedAt), data: { ...task } }
}

/** UI-first выбор одинаков для клиента и сервера; пустой UI означает API fallback. */
export function queryWidgetItems(items: WidgetToolItem[], text = '', kinds: string[] = [], limit = 50): WidgetToolItem[] {
  const needle = text.trim().toLocaleLowerCase()
  return items.filter((item) => (!kinds.length || kinds.includes(item.kind)) && (!needle || item.title.toLocaleLowerCase().includes(needle) || JSON.stringify(item.data).toLocaleLowerCase().includes(needle))).slice(0, Math.max(1, Math.min(limit, 100)))
}

export type WidgetAssistantProposal = Extract<WidgetAssistantCommand, { type:
  'propose.task-create' | 'propose.task-update' | 'propose.rephrase' | 'propose.acceptance-criteria' | 'propose.settings-update'
}>

export function isWidgetAssistantProposal(command: WidgetAssistantCommand): command is WidgetAssistantProposal {
  return command.type.startsWith('propose.')
}

/** Human-readable diff rows shown before every assistant mutation. */
export function widgetProposalDiff(command: WidgetAssistantProposal, context: WidgetAssistantContext<KanbanAssistantSelection>): Array<{ field: string; before: unknown; after: unknown }> {
  if (command.type === 'propose.settings-update') {
    return Object.entries(command.patch).map(([field, after]) => ({ field, before: undefined, after }))
  }
  if (command.type === 'propose.task-create') {
    return Object.entries(command.input).map(([field, after]) => ({ field, before: undefined, after }))
  }
  const task = context.selection?.openTask?.id === command.taskId ? context.selection.openTask : null
  const patch: SupportedTaskPatch =
    command.type === 'propose.task-update' ? command.patch :
      command.type === 'propose.acceptance-criteria' ? { acceptanceCriteria: command.value } :
        { [command.field]: command.value }
  return Object.entries(patch).map(([field, after]) => ({ field, before: task?.[field as keyof Task], after }))
}

const TASK_PATCH_KEYS = new Set<keyof SupportedTaskPatch>(['title', 'description', 'acceptanceCriteria', 'type', 'parentId', 'priority', 'assignee', 'agentId', 'labels', 'skills', 'storyPoints', 'dueDate', 'flagged', 'columnId'])
const TASK_CREATE_KEYS = new Set<keyof WidgetTaskCreate>(['columnId', 'title', 'description', 'acceptanceCriteria', 'type', 'parentId', 'priority', 'assignee', 'agentId', 'labels', 'skills', 'storyPoints', 'dueDate'])
const SETTING_PATCH_KEYS = new Set<keyof SupportedSettingPatch>(['model', 'llmProvider', 'codexModel', 'llmEngineId', 'aiAssistProvider', 'aiAssistModel', 'permissionMode', 'theme', 'autoSpeak', 'showConsole'])

function safePatch(value: unknown, allowed: ReadonlySet<string>): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  return entries.length > 0 && entries.every(([key]) => allowed.has(key)) ? Object.fromEntries(entries) : null
}

/** Parse the assistant JSON envelope; malformed or unsupported commands remain visible text and never execute. */
export function parseWidgetAssistantReply(raw: string): { text: string; commands: WidgetAssistantCommand[] } {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? raw
  let value: unknown
  try { value = JSON.parse(fenced) } catch { return { text: raw, commands: [] } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { text: raw, commands: [] }
  const envelope = value as { text?: unknown; commands?: unknown }
  const commands: WidgetAssistantCommand[] = []
  if (Array.isArray(envelope.commands)) {
    for (const item of envelope.commands) {
      if (!item || typeof item !== 'object') continue
      const command = item as Record<string, unknown>
      const type = command.type
      const projectId = typeof command.projectId === 'string' ? command.projectId : ''
      const taskId = typeof command.taskId === 'string' ? command.taskId : ''
      const reason = typeof command.reason === 'string' ? command.reason : undefined
      if (type === 'navigate.project-settings' && projectId) commands.push({ type, projectId })
      else if (type === 'navigate.task' && projectId && taskId) commands.push({ type, projectId, taskId })
      else if (type === 'propose.task-create' && projectId) {
        const input = safePatch(command.input, TASK_CREATE_KEYS)
        if (input && typeof input.columnId === 'string' && typeof input.title === 'string' && input.title.trim()) commands.push({ type, projectId, input: input as WidgetTaskCreate, ...(reason ? { reason } : {}) })
      } else if (type === 'propose.task-update' && projectId && taskId) {
        const patch = safePatch(command.patch, TASK_PATCH_KEYS)
        if (patch) commands.push({ type, projectId, taskId, patch: patch as SupportedTaskPatch, ...(reason ? { reason } : {}) })
      } else if (type === 'propose.rephrase' && projectId && taskId && (command.field === 'title' || command.field === 'description' || command.field === 'acceptanceCriteria') && typeof command.value === 'string') {
        commands.push({ type, projectId, taskId, field: command.field, value: command.value, ...(reason ? { reason } : {}) })
      } else if (type === 'propose.acceptance-criteria' && projectId && taskId && typeof command.value === 'string') {
        commands.push({ type, projectId, taskId, value: command.value, ...(reason ? { reason } : {}) })
      } else if (type === 'propose.settings-update') {
        const patch = safePatch(command.patch, SETTING_PATCH_KEYS)
        if (patch) commands.push({ type, patch: patch as SupportedSettingPatch, ...(reason ? { reason } : {}) })
      }
    }
  }
  return { text: typeof envelope.text === 'string' ? envelope.text : raw, commands }
}
