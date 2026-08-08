import type { KanbanColumn, ProjectSummary, Task } from './projects'
import type { Settings } from './types'

/** Widget-neutral, secret-free snapshot supplied to an assistant. */
export interface WidgetAssistantContext<TSelection = unknown> {
  version: 1
  widget: { kind: string; instanceId: string; title: string }
  project: Pick<ProjectSummary, 'id' | 'name' | 'description' | 'technologies' | 'skills'> | null
  selection: TSelection | null
  recentActions: WidgetUserAction[]
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
  'assignee' | 'labels' | 'skills' | 'storyPoints' | 'dueDate' | 'flagged' | 'columnId'
>>

export type SupportedSettingPatch = Partial<Pick<Settings,
  'model' | 'llmProvider' | 'codexModel' | 'llmEngineId' | 'aiAssistProvider' | 'aiAssistModel' |
  'permissionMode' | 'theme' | 'autoSpeak' | 'showConsole'
>>

export type WidgetAssistantCommand =
  | { type: 'navigate.project-settings'; projectId: string }
  | { type: 'navigate.task'; projectId: string; taskId: string }
  | { type: 'propose.task-update'; projectId: string; taskId: string; patch: SupportedTaskPatch; reason?: string }
  | { type: 'propose.rephrase'; projectId: string; taskId: string; field: 'title' | 'description' | 'acceptanceCriteria'; value: string; reason?: string }
  | { type: 'propose.acceptance-criteria'; projectId: string; taskId: string; value: string; reason?: string }
  | { type: 'propose.settings-update'; patch: SupportedSettingPatch; reason?: string }

export interface KanbanAssistantSelection {
  board: { projectId: string; columns: KanbanColumn[] }
  openTask: Task | null
  selectedField: keyof SupportedTaskPatch | null
}

export type WidgetAssistantProposal = Extract<WidgetAssistantCommand, { type:
  'propose.task-update' | 'propose.rephrase' | 'propose.acceptance-criteria' | 'propose.settings-update'
}>

export function isWidgetAssistantProposal(command: WidgetAssistantCommand): command is WidgetAssistantProposal {
  return command.type.startsWith('propose.')
}

/** Human-readable diff rows shown before every assistant mutation. */
export function widgetProposalDiff(command: WidgetAssistantProposal, context: WidgetAssistantContext<KanbanAssistantSelection>): Array<{ field: string; before: unknown; after: unknown }> {
  if (command.type === 'propose.settings-update') {
    return Object.entries(command.patch).map(([field, after]) => ({ field, before: undefined, after }))
  }
  const task = context.selection?.openTask?.id === command.taskId ? context.selection.openTask : null
  const patch: SupportedTaskPatch =
    command.type === 'propose.task-update' ? command.patch :
      command.type === 'propose.acceptance-criteria' ? { acceptanceCriteria: command.value } :
        { [command.field]: command.value }
  return Object.entries(patch).map(([field, after]) => ({ field, before: task?.[field as keyof Task], after }))
}

const TASK_PATCH_KEYS = new Set<keyof SupportedTaskPatch>(['title', 'description', 'acceptanceCriteria', 'type', 'parentId', 'priority', 'assignee', 'labels', 'skills', 'storyPoints', 'dueDate', 'flagged', 'columnId'])
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
      else if (type === 'propose.task-update' && projectId && taskId) {
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
