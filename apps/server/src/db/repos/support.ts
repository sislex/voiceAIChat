// Общие типы строк и чистые помощники слоя БД, нужные нескольким доменным репозиториям.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import type { AutomatedQaScenario, AutomatedQaScenarioStep } from '@voicechat/shared'
import { EMPTY_AUTOMATED_QA_SCENARIO, isPreviewAction, type KanbanColumn, type KanbanColumnSemanticType, type KbContextMode, DEFAULT_CI_CLAUDE_MODEL, type CiRunMode, type CiClarifyLevel, CI_CLARIFY_MAX_LIMIT, type CiRun, type CiStatus, type CiSlotProgress, type CiFixDiagnosticContext } from '@voicechat/shared'


/** Сценарий приходит из настроек проекта, то есть извне: отбрасываем шаги с
 *  неизвестным действием, иначе раннер упадёт на середине прогона. */
export function normalizeAutomatedQaScenario(value: AutomatedQaScenario | null | undefined): AutomatedQaScenario {
  if (!value || typeof value.startUrl !== 'string') return EMPTY_AUTOMATED_QA_SCENARIO
  const name = typeof value.name === 'string' && value.name.trim() ? { name: value.name.trim() } : {}
  const steps: AutomatedQaScenarioStep[] = (Array.isArray(value.steps) ? value.steps : [])
    .filter((step) => step && typeof step.id === 'string' && isPreviewAction(step.action))
    .slice(0, 100)
    .map((step) => ({
      id: step.id, title: typeof step.title === 'string' && step.title.trim() ? step.title.trim() : step.action.kind, action: step.action,
      ...(typeof step.expectText === 'string' && step.expectText ? { expectText: step.expectText } : {}),
      ...(typeof step.expectAbsentText === 'string' && step.expectAbsentText ? { expectAbsentText: step.expectAbsentText } : {})
    }))
  return { ...name, startUrl: value.startUrl.trim(), steps }
}

export const TASK_COMMIT_COMMAND_NAME = 'Закоммитить работу в ветку задачи'

export const TASK_COMMIT_COMMAND_SCRIPT = `set -eu
cd -- "$SLUG"
git config user.name "voicechat-ci"
git config user.email "ci@voicechat.local"
# Ветка задачи: модель обычно уже на ней, иначе поднимаем её на текущем HEAD.
git checkout -B "$BRANCH"
git add -A
if git diff --cached --quiet; then
  echo "Нет незакоммиченных изменений — коммит не нужен"
  exit 0
fi
git commit -q -m "$TASK_KEY: работа CI-рана"
git --no-pager log --oneline -1`

/** Инъектируемые зависимости — для детерминированных тестов. */
export interface DbDeps {
  /** Генератор id (по умолчанию crypto.randomUUID). */
  newId?: () => string
  /** Источник текущего времени в мс (по умолчанию Date.now). */
  now?: () => number
}

/** Ключ настроек per-user в key-value таблице settings (`app:<userId>`). */
export function settingsKey(userId: string): string {
  return `app:${userId}`
}

/** Шаг дробного ранга для порядка колонок/задач. */
export const RANK_STEP = 1024

export interface ColumnRow {
  id: string
  project_id: string
  name: string
  semantic_type: string
  position: number
  hidden: number
  wip_limit: number | null
  created_at: number
}

export interface TaskRow {
  id: string
  project_id: string
  column_id: string
  title: string
  /** Скелет доски эти два поля не выбирает — они есть только в полной задаче. */
  description?: string
  acceptance_criteria?: string
  type: string
  parent_id: string | null
  source_task_id: string | null
  priority: string
  assignee: string | null
  created_by: string | null
  created_by_name: string | null
  agent_id: string | null
  labels: string | null
  skills: string | null
  story_points: number | null
  due_date: number | null
  flagged: number
  auto_pilot: number
  auto_pilot_fix_cycles: number
  done_at: number | null
  preview_ready: number
  seq: number | null
  position: number
  created_at: number
  updated_at: number
  chat_id?: string | null
  merge_source_branch?: string | null
  merge_source_sha?: string | null
  active_merge_run_id?: string | null
  latest_merge_run_id?: string | null
  active_merge_status?: string | null
  merge_permitted?: number
  merge_machine_bound?: number
  merged_sha?: string | null
  merged_source_sha?: string | null
  task_preparation_run_id?: string | null
  task_preparation_status?: string | null
  task_preparation_error?: string | null
  task_preparation_log?: string | null
}

/** Разбор JSON-массива строк из колонки (терпит битые значения). */
export function parseStringArray(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function normColumnSemantic(raw: string): KanbanColumnSemanticType {
  return raw === 'backlog' || raw === 'preparation' || raw === 'ready' || raw === 'development' || raw === 'component_qa' || raw === 'integration_tests' || raw === 'automated_qa' || raw === 'testing' || raw === 'qa_preparation' || raw === 'manual_qa' || raw === 'awaiting_merge' || raw === 'merge' || raw === 'decision_required' || raw === 'done' || raw === 'cancelled' ? raw : 'custom'
}

export function mapColumn(r: ColumnRow): KanbanColumn {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    semanticType: normColumnSemantic(r.semantic_type),
    position: r.position,
    hidden: r.hidden !== 0,
    wipLimit: r.wip_limit ?? null,
    createdAt: r.created_at
  }
}

export function normCiStatus(s: string): CiStatus {
  return s === 'running' || s === 'awaiting_input' || s === 'success' || s === 'failed' || s === 'interrupted' || s === 'cancelled' || s === 'timeout' || s === 'skipped' ? s : 'queued'
}

/** Режим БЗ из строки БД: неизвестное значение — безопасный дефолт `auto`. */
export function normKbContextMode(value: string | KbContextMode | null | undefined): KbContextMode {
  return value === 'manual' || value === 'off' ? value : 'auto'
}

export function normRunMode(m: string | null | undefined): CiRunMode {
  return m === 'plan' ? 'plan' : 'development'
}

export function normClarifyLevel(l: string | null | undefined): CiClarifyLevel {
  return l === 'none' || l === 'medium' || l === 'detailed' ? l : 'few'
}

export function clampClarifyMax(n: number | null | undefined): number {
  return Math.min(CI_CLARIFY_MAX_LIMIT, Math.max(1, Math.round(Number(n ?? 3)) || 1))
}

export function parseJsonValue<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

export function parseSlotProgress(j: string): CiSlotProgress {
  try {
    const o = JSON.parse(j) as Partial<CiSlotProgress>
    return { done: Number(o.done ?? 0), total: Number(o.total ?? 0), phase: String(o.phase ?? ''), fixing: o.fixing === true }
  } catch {
    return { done: 0, total: 0, phase: '' }
  }
}

export interface CiRunRow {
  id: string; project_id: string; task_id: string; agent_id: string | null; agent_owner_id: string | null; agent_owner_name: string | null; agent_selection_source: string | null; status: string; error: string | null
  workspace_id: string | null; triggered_by: string; prev_column_id: string | null; run_column_id: string | null; terminal_column_id: string | null
  llm_engine_id: string | null; llm_provider: string; llm_model: string
  mode: string | null; clarify_level: string | null; clarify_max: number | null
  conversation_id: string | null; model_session_id: string | null; fix_context_json: string | null; kb_context_mode: string | null
  slot_progress_json: string; started_at: number | null; finished_at: number | null
  duration_ms: number | null; created_at: number
}

export function mapCiRun(r: CiRunRow): CiRun {
  return {
    id: r.id, projectId: r.project_id, taskId: r.task_id, agentId: r.agent_id,
    agentOwnerId: r.agent_owner_id ?? null, agentOwnerName: r.agent_owner_name ?? 'неизвестно',
    agentSelectionSource: r.agent_selection_source === 'explicit' || r.agent_selection_source === 'explicit_bypass' || r.agent_selection_source === 'task_pinned' || r.agent_selection_source === 'project_default' || r.agent_selection_source === 'user_project_default' || r.agent_selection_source === 'fallback' ? r.agent_selection_source : 'unknown',
    status: normCiStatus(r.status), error: r.error?.trim() || null, workspaceId: r.workspace_id, triggeredBy: r.triggered_by,
    prevColumnId: r.prev_column_id, runColumnId: r.run_column_id ?? null, terminalColumnId: r.terminal_column_id ?? null, llmEngineId: r.llm_engine_id ?? null, llmProvider: r.llm_provider === 'codex' ? 'codex' : 'claude', llmModel: r.llm_provider === 'codex' ? (r.llm_model ?? '') : (r.llm_model || DEFAULT_CI_CLAUDE_MODEL),
    mode: normRunMode(r.mode), clarifyLevel: normClarifyLevel(r.clarify_level), clarifyMax: clampClarifyMax(r.clarify_max),
    conversationId: r.conversation_id, modelSessionId: r.model_session_id ?? null,
    fixContext: parseJsonValue<CiFixDiagnosticContext | null>(r.fix_context_json, null), kbContextMode: normKbContextMode(r.kb_context_mode),
    slotProgress: parseSlotProgress(r.slot_progress_json),
    startedAt: r.started_at, finishedAt: r.finished_at, durationMs: r.duration_ms, createdAt: r.created_at
  }
}
