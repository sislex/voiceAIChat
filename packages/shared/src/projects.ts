export const MACHINE_STORAGE_FORMAT_VERSION = 1

export type MachineStorageStatus = 'ready' | 'offline' | 'unavailable'

export interface MachineStorage {
  id: string
  machineId: string
  rootPath: string
  status: MachineStorageStatus
  formatVersion: number
  primary?: boolean
  error?: string
}

export type MachineStorageMarkerState =
  | 'empty'
  | 'current'
  | 'existing'
  | 'conflict'
  | 'corrupt'

export interface MachineStorageInspection {
  rootPath: string
  markerState: MachineStorageMarkerState
  storageId?: string
  formatVersion?: number
}

export function recommendedMachineStoragePath(platform: string, homePath: string): string {
  const separator = platform === 'win32' ? '\\' : '/'
  return homePath.replace(/[\\/]+$/, '') + separator + 'ChatAI'
}

/**
 * Канонический абсолютный путь в синтаксисе целевой ОС. На Windows принимаются
 * drive, UNC и MSYS /c/...; неоднозначные, ненормализованные и корневые пути
 * отклоняются до обращения к агенту.
 */
export function normalizeMachineStoragePath(input: string, platform: string): string {
  const raw = input.trim()
  if (!raw || raw === '~' || raw.startsWith('~/')) throw new Error('Укажите абсолютный путь')
  if (platform === 'win32') {
    let value = raw.replace(/^\/([A-Za-z])(?=\/)/, (_m, drive: string) => `${drive.toUpperCase()}:`).replace(/\//g, '\\')
    if (/^[A-Za-z]:\\/.test(value)) value = value[0].toUpperCase() + value.slice(1)
    const drive = /^[A-Za-z]:\\/.test(value)
    const unc = /^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(value)
    if (!drive && !unc) throw new Error('Укажите абсолютный Windows-, UNC- или MSYS-путь')
    value = value.replace(/\\+/g, '\\')
    if (unc) value = '\\\\' + value.replace(/^\\+/, '')
    value = value.replace(/\\+$/, '')
    if (/^[A-Za-z]:$/.test(value) || /^\\\\[^\\]+\\[^\\]+$/.test(value)) {
      throw new Error('Корень диска или сетевого ресурса нельзя использовать как хранилище')
    }
    if (value.split('\\').some((part) => part === '.' || part === '..')) throw new Error('Путь должен быть нормализован')
    return value
  }
  if (!raw.startsWith('/')) throw new Error('Укажите абсолютный POSIX-путь')
  const value = raw.replace(/\/+$/, '')
  if (!value) throw new Error('Корень файловой системы нельзя использовать как хранилище')
  if (value.includes('\\') || value.slice(1).split('/').some((part) => part === '.' || part === '..' || part === '')) {
    throw new Error('Путь должен быть нормализован')
  }
  return value
}

export function isMachineStoragePathAllowed(path: string, allowedDirs: string[], platform: string): boolean {
  if (allowedDirs.length === 0) return true
  const fold = (value: string): string => platform === 'win32' ? value.toLowerCase() : value
  const separator = platform === 'win32' ? '\\' : '/'
  const candidate = fold(path)
  return allowedDirs.some((dir) => {
    try {
      const allowed = fold(normalizeMachineStoragePath(dir, platform))
      return candidate === allowed || candidate.startsWith(allowed + separator)
    } catch {
      return false
    }
  })
}

export interface ChatStorageBinding {
  conversationId: string
  machineId: string
  storageId: string
  relativePath: string
}

export type StorageContext =
  | { kind: 'chat'; conversationId: string }
  | { kind: 'project'; projectId: string; conversationId: string }
  | { kind: 'task'; projectId: string; taskId: string; conversationId: string }

const SAFE_STORAGE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function validateStorageRelativePath(path: string): string {
  if (/^(?:[\\/]|[A-Za-z]:[\\/])/.test(path)) throw new Error('relativePath must be relative')
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/g, '')
  if (!normalized || normalized.split('/').some((part) => !SAFE_STORAGE_SEGMENT.test(part) || part === '.' || part === '..')) {
    throw new Error('relativePath must contain only safe relative path segments')
  }
  return normalized
}

export function recommendedChatStoragePath(context: StorageContext): string {
  const conversationId = validateStorageRelativePath(context.conversationId)
  if (context.kind === 'chat') return `chats/${conversationId}`
  const projectId = validateStorageRelativePath(context.projectId)
  if (context.kind === 'project') return `projects/${projectId}/chats/${conversationId}`
  const taskId = validateStorageRelativePath(context.taskId)
  return `projects/${projectId}/tasks/${taskId}/chats/${conversationId}`
}

export function recommendedEnvironmentPath(projectId: string, kind: 'production' | 'staging'): string {
  return `projects/${validateStorageRelativePath(projectId)}/environments/${kind}`
}

export function recommendedTaskTestEnvironmentPath(projectId: string, taskId: string): string {
  return `projects/${validateStorageRelativePath(projectId)}/tasks/${validateStorageRelativePath(taskId)}/environments/test`
}

import type { CiRunSummary, CiReuseStrategy, CiStatus, CiRunMode } from './ci'
import type { KbContextMode } from './types'

// Типы домена «Проекты» + канбан-доска. Разделяются server/web/desktop.

/** Приоритет задачи. */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

/** Все приоритеты (порядок = порядок в меню, по возрастанию важности). */
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

/** Тип элемента планирования. В БД исторически все элементы лежат в tasks. */
export type WorkItemType = 'epic' | 'story' | 'task'
export const WORK_ITEM_TYPES: WorkItemType[] = ['epic', 'story', 'task']

/**
 * Навыки по умолчанию, задаваемые в настройках проекта отдельно для каждого
 * типа элемента. При создании эпика/стори/таска эти навыки автоматически
 * копируются в его карточку (`Task.skills`), где их можно править.
 */
export interface WorkItemDefaultSkills {
  epic: string[]
  story: string[]
  task: string[]
}

/** Пустой набор навыков по умолчанию (все типы — []). */
export const EMPTY_DEFAULT_SKILLS: WorkItemDefaultSkills = { epic: [], story: [], task: [] }


/** Стабильное назначение колонки, не зависящее от отображаемого имени. */
export type KanbanColumnSemanticType =
  | 'backlog'
  | 'preparation'
  | 'ready'
  | 'development'
  | 'component_qa'
  | 'integration_tests'
  | 'automated_qa'
  /** Legacy aliases kept for existing boards and persisted history. */
  | 'testing'
  | 'qa_preparation'
  | 'manual_qa'
  | 'awaiting_merge'
  | 'merge'
  | 'decision_required'
  | 'done'
  | 'cancelled'
  | 'custom'

export const KANBAN_COLUMN_SEMANTIC_TYPES: KanbanColumnSemanticType[] = [
  'backlog', 'preparation', 'ready', 'development', 'component_qa', 'integration_tests',
  'automated_qa', 'testing', 'qa_preparation', 'manual_qa', 'awaiting_merge', 'merge',
  'decision_required', 'done', 'cancelled', 'custom'
]

/** Canonical machine workflow. Display names are deliberately absent. */
export const QA_WORKFLOW: readonly KanbanColumnSemanticType[] = [
  'backlog', 'preparation', 'ready', 'development', 'component_qa',
  'integration_tests', 'automated_qa', 'manual_qa', 'awaiting_merge', 'merge', 'done'
]

const QA_WORKFLOW_TRANSITIONS: Readonly<Record<string, readonly KanbanColumnSemanticType[]>> = {
  backlog: ['preparation'],
  preparation: ['ready', 'decision_required'],
  ready: ['development', 'preparation'],
  development: ['component_qa', 'decision_required'],
  component_qa: ['integration_tests', 'development', 'decision_required'],
  integration_tests: ['automated_qa', 'development', 'decision_required'],
  automated_qa: ['manual_qa', 'integration_tests', 'development', 'decision_required'],
  manual_qa: ['awaiting_merge', 'development', 'preparation', 'decision_required'],
  awaiting_merge: ['merge', 'component_qa', 'automated_qa', 'decision_required'],
  merge: ['done', 'decision_required'],
  done: [],
  decision_required: []
}

/** Automatic routes may never leave decision_required; a user decision is required. */
export function canTransitionWorkflow(
  from: KanbanColumnSemanticType,
  to: KanbanColumnSemanticType,
  actor: 'user' | 'automation'
): boolean {
  if (from === to) return true
  if (from === 'decision_required') return actor === 'user' && to !== 'done'
  return (QA_WORKFLOW_TRANSITIONS[from] ?? []).includes(to)
}

/** Роль пользователя в проекте. */
export type ProjectRole = 'owner' | 'member'

/** Участник проекта. */
export interface ProjectMember {
  /** Логин (он же id владельца данных в системе). */
  username: string
  role: ProjectRole
  addedAt: number
  /** Заблокированный пользователь остаётся участником, но не может быть исполнителем. */
  active?: boolean
}

/**
 * Проект в списке. `role` — роль текущего пользователя (запрос знает uid),
 * технологии/навыки — свободные теги.
 */
export interface ProjectSummary {
  id: string
  name: string
  description: string
  gitUrl: string | null
  /** Адрес веб-превью по умолчанию для чатов проекта. */
  previewUrl?: string | null
  technologies: string[]
  skills: string[]
  /** Навыки по умолчанию для новых элементов, отдельно по типу. */
  defaultSkills: WorkItemDefaultSkills
  /** Логин создателя проекта. */

  createdBy: string
  createdAt: number
  updatedAt: number
  /** Роль текущего пользователя в этом проекте. */
  role: ProjectRole
  commitPolicy: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'
  mergeTransport: 'local' | 'github_pull_request'
  agentPlanApprovalMode: 'manual' | 'automatic'
  testCommand?: string
  productionDeployCommand?: string
  /** Отдельная машина, с которой разрешён только production deploy. */
  productionAgentId?: string | null
  productionCheckoutPath?: string
  productionHealthCheckCommand?: string
  /** Настраиваемые owner-only лимиты; новый ран копирует их в шаги. */
  releaseTimeouts?: import('./release').ReleaseTimeouts
  /** CI-раннер: базовая ветка воркфлоу. */
  ciBaseBranch?: string
  /** CI-раннер: шаблон ветки, по умолчанию `{task_number}` (`CHAT-172`); legacy `{slug}` поддерживается. */
  ciBranchTemplate?: string
  /** CI-раннер: стратегия повтора при существующей рабочей директории. */
  ciReuseStrategy?: CiReuseStrategy
  /** CI-раннер: ссылка на секрет авторизации выполнения (или ''). */
  ciExecAuthRef?: string
  /**
   * CI-раннер: режим базы знаний в ходах модели рана. Настройка ПРОЕКТА, а не
   * чата: ран берёт её у проекта и фиксирует в `CiRun.kbContextMode` на старте,
   * поэтому смена режима действует со следующего рана.
   */
  ciKbContextMode?: KbContextMode
  /** Максимум автоматических fix cycle после продуктового падения полного pipeline. */
  ciTestFixCycleLimit?: number
  /**
   * Через сколько дней после попадания в колонку «Готово» задача пропадает с
   * доски (как в Jira). `null` — не скрывать никогда, `0` — убрать в конце дня.
   * Задача при этом не удаляется: её видно по прямой ссылке и с включённым
   * «Показать завершённые».
   */
  doneRetentionDays?: number | null
}

/** Машина проекта: агент + рабочая папка проекта на этой машине. */
export interface ProjectMachine {
  agentId: string
  /** Безопасные данные машины для участников проекта. */
  name?: string
  owner?: string
  ownership?: 'mine' | 'other'
  online?: boolean
  sharedWithProject?: boolean
  isMyDefault?: boolean
  canUse?: boolean
  unavailableReason?: string | null
  load?: number
  addedAt?: number
  /** Папка проекта на этой машине (рабочий каталог). '' — не задана. */
  path: string
  /** Корень пула рабочих копий CI на этой машине. */
  reposRoot: string
  /** Явно настроенный SSH hostname/IP для ручного preview-туннеля. */
  sshHost?: string
  /** Явно настроенный SSH-пользователь для ручного preview-туннеля. */
  sshUser?: string
}

/** Проект со всем составом (ответ get/create/update). */
export interface ProjectDetail extends ProjectSummary {
  members: ProjectMember[]
  /** Машины проекта с папками. */
  machines: ProjectMachine[]
  /** Машина по умолчанию (agentId ∈ machines) или null. */
  defaultAgentId: string | null
}

/** Колонка канбан-доски. Колонка = статус задачи. */
export interface KanbanColumn {
  id: string
  projectId: string
  name: string
  semanticType: KanbanColumnSemanticType
  /** Дробный ранг для порядка колонок. */
  position: number
  /** Скрыта из основного вида доски (задачи сохраняют статус). */
  hidden: boolean
  /** WIP-лимит (макс. карточек в колонке) или null — без лимита. */
  wipLimit: number | null
  createdAt: number
}

/** Нормализованный сервером последний актуальный процесс или терминальный результат задачи. */
export type TaskRunResultOutcome = 'active' | 'success' | 'failure' | 'cancelled' | 'skipped'
export type TaskRunResultKind =
  | 'preparation'
  | 'development'
  | 'component_qa'
  | 'integration_tests'
  | 'automated_qa'
  | 'qa_preparation'
  | 'manual_qa'
  | 'merge'

export function normalizeTaskRunOutcome(status: string): TaskRunResultOutcome {
  if (['queued', 'running', 'awaiting_input', 'waiting_for_answer', 'validating', 'active', 'checking', 'fetching', 'merging', 'resolving_conflicts', 'kb_update', 'testing', 'pushing', 'deploying', 'production_checks', 'rolling_back'].includes(status)) return 'active'
  if (['success', 'completed', 'passed'].includes(status)) return 'success'
  if (status === 'cancelled') return 'cancelled'
  if (['skipped', 'stale'].includes(status)) return 'skipped'
  // failed, blocked, timeout, gate_failed, interrupted, decision_required and
  // future terminal server failures remain fail-closed for attention signalling.
  return 'failure'
}

export interface TaskRunResult {
  id: string
  kind: TaskRunResultKind
  /** Исходный серверный статус; UI принимает решение только по outcome. */
  status: string
  outcome: TaskRunResultOutcome
  createdAt: number
  finishedAt: number | null
}

/** Задача канбан-доски. Статус задачи = её колонка (columnId). */
export interface Task {
  id: string
  projectId: string
  columnId: string
  type: WorkItemType
  parentId: string | null
  title: string
  description: string
  acceptanceCriteria: string
  priority: TaskPriority
  /** Логин исполнителя (участник проекта) или null. */
  assignee: string | null
  /** Неизменяемый автор из серверной сессии; null только у legacy/system задач. */
  createdBy?: string | null
  /** Историческое имя автора, сохранённое при создании. */
  createdByName?: string | null
  /** Выбранная для CI машина проекта; null — машина проекта по умолчанию. */
  agentId?: string | null
  /** Метки (свободные строки), как labels в Jira. */
  labels: string[]
  /**
   * Навыки карточки. При создании заполняются навыками по умолчанию из настроек
   * проекта (по типу), дальше правятся вручную в карточке.
   */
  skills: string[]

  /** Оценка в стори-поинтах или null. */
  storyPoints: number | null
  /** Срок (unix ms) или null. */
  dueDate: number | null
  /** Помечена флагом «внимание» (Jira flag). */
  flagged: boolean
  /**
   * Момент попадания в колонку с семантикой `done` (unix ms) или null, если
   * задача не завершена. Отсчёт срока, после которого карточка уходит с доски.
   */
  doneAt?: number | null
  /** Сервер подтвердил healthy feature-preview для текущей задачи. */
  previewReady?: boolean
  /** Порядковый номер задачи в проекте — основа ключа «PRJ-42». */
  seq: number
  /** Дробный ранг для порядка внутри колонки. */
  position: number
  createdAt: number
  updatedAt: number
  /**
   * Id связанного с задачей чата текущего пользователя (или null, если чат ещё
   * не создан). Заполняется только в снапшоте доски; в ответах create/update — null.
   */
  chatId?: string | null
  /** Последняя подготовленная и отправленная ветка development-рана. */
  mergeSourceBranch?: string | null
  mergeSourceSha?: string | null
  /** Активный merge-ран восстанавливается вместе со снапшотом доски. */
  activeMergeRunId?: string | null
  latestMergeRunId?: string | null
  activeMergeStatus?: string | null
  /** Серверный снимок прав и привязки машины; UI не заменяет им API-проверку. */
  mergePermitted?: boolean
  mergeMachineBound?: boolean
  /** Merge-коммит последнего успешного merge-рана. */
  mergedSha?: string | null
  /** Source SHA, который был использован последним успешным merge-раном. */
  mergedSourceSha?: string | null
  /** Последняя отдельная попытка пред-разработческой подготовки. */
  taskPreparationRunId?: string | null
  taskPreparationStatus?: import('./qa').TaskPreparationStatus | null
  taskPreparationError?: string | null
  taskPreparationLog?: string | null
  /** Последний актуальный результат всех серверных этапов; отсутствие данных не является ошибкой. */
  latestRunResult?: TaskRunResult | null
}

/**
 * Приводит критерии приёмки к единому Markdown-списку. Верхнеуровневые
 * непустые строки становятся пунктами; строки с отступом, вложенные списки,
 * цитаты и fenced-блоки остаются содержимым текущего пункта.
 *
 * Функция намеренно идемпотентна: её используют и UI, и сервер перед записью.
 */
export function normalizeAcceptanceCriteria(value: string): string {
  const source = value.replace(/\r\n?/g, '\n')
  if (!source.trim()) return ''

  const items: string[][] = []
  let current: string[] | null = null
  let inFence = false

  const newItem = (text: string): string[] | null => {
    let clean = text.trim()
    // Убираем любое количество старых ручных номеров: «1. 3. текст» не
    // превращается в двойную нумерацию.
    while (/^\d+[.)]\s+/.test(clean)) clean = clean.replace(/^\d+[.)]\s+/, '')
    clean = clean.replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/, '')
    return clean ? [clean] : null
  }

  for (const line of source.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (current?.length && current[current.length - 1] !== '') current.push('')
      continue
    }

    const indented = /^\s+/.test(line)
    const nested = /^(?:>\s?|#{1,6}\s+)/.test(trimmed)
    const fence = /^\`\`\`|^~~~/.test(trimmed)

    if (current && (inFence || indented || nested || fence)) {
      current.push(trimmed)
      if (fence) inFence = !inFence
      continue
    }

    current = newItem(trimmed)
    if (current) items.push(current)
    if (current && fence) inFence = true
  }

  return items.map((lines, index) => {
    while (lines[lines.length - 1] === '') lines.pop()
    const [first, ...rest] = lines
    const body = rest.map((line) => line ? `   ${line}` : '   ').join('\n')
    return `${index + 1}. ${first}${body ? `\n${body}` : ''}`
  }).join('\n')
}

/**
 * Сравнивает задачи одной колонки для показа на доске. В `development` сверху
 * стоят более приоритетные задачи; при одинаковом приоритете сохраняется ручной
 * порядок. В `done` первой идёт задача, которая последней попала в колонку;
 * последующие правки карточки не влияют на этот порядок. У старых строк без
 * `doneAt` остаётся стабильный fallback по ручному рангу, времени создания и id.
 */
export function compareTasksInColumn(
  a: Pick<Task, 'doneAt' | 'position' | 'createdAt' | 'id'> & Partial<Pick<Task, 'priority'>>,
  b: Pick<Task, 'doneAt' | 'position' | 'createdAt' | 'id'> & Partial<Pick<Task, 'priority'>>,
  semanticType: KanbanColumnSemanticType
): number {
  if (semanticType === 'development') {
    const priorityRank = (priority: TaskPriority | undefined): number => TASK_PRIORITIES.indexOf(priority ?? 'medium')
    const priorityOrder = priorityRank(b.priority) - priorityRank(a.priority)
    if (priorityOrder !== 0) return priorityOrder
  }
  if (semanticType === 'done') {
    const aDoneAt = a.doneAt ?? null
    const bDoneAt = b.doneAt ?? null
    if (aDoneAt != null && bDoneAt != null && aDoneAt !== bDoneAt) return bDoneAt - aDoneAt
    if (aDoneAt != null && bDoneAt == null) return -1
    if (aDoneAt == null && bDoneAt != null) return 1
  }
  return a.position - b.position || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

/** Сколько дней завершённая задача ещё висит на доске по умолчанию (как в Jira). */
export const DEFAULT_DONE_RETENTION_DAYS = 14

/** День в миллисекундах — шаг порога «сколько держать завершённые на доске». */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Пора ли убрать завершённую задачу с доски. `doneAt` — момент попадания в
 * колонку done, `retentionDays` — настройка проекта: null/мусор — не скрывать
 * никогда, 0 — убрать в конце дня завершения. Ровно 0 мс не берём специально:
 * в «Готово» карточку переносит не только человек, но и CI-раннер после
 * успешного мержа, а карточка, исчезнувшая с доски в ту же секунду, читается как
 * «работа пропала без следа». Скрытие не удаляет задачу: она приходит с
 * `includeCompleted` и открывается по прямой ссылке.
 */
export function isCompletedHidden(
  doneAt: number | null | undefined,
  retentionDays: number | null | undefined,
  now: number
): boolean {
  if (doneAt == null || retentionDays == null) return false
  if (!Number.isFinite(retentionDays) || retentionDays < 0) return false
  if (retentionDays === 0) return now >= endOfDay(doneAt)
  return now - doneAt >= retentionDays * DAY_MS
}

/** Полночь следующего дня после `ts` (по времени машины, где считается доска). */
function endOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

/** Новое доменное имя; Task остаётся alias для совместимости. */

export type WorkItem = Task

// Транслитерация кириллицы: ключ проекта в Jira — латинский (ЧатАИ → CHA).
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}

/** Ключ проекта из имени: латинские заглавные, как в Jira (Voice Chat → VC). */
export function projectKey(name: string): string {
  const words = [...name.toLowerCase()]
    .map((ch) => CYR[ch] ?? ch)
    .join('')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (!words.length) return 'PRJ'
  const key = words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join('').slice(0, 4)
  return key.toUpperCase()
}

/** Ключ задачи «PRJ-42» из имени проекта и порядкового номера. */
export function issueKey(projectName: string, task: Pick<Task, 'seq'>): string {
  return `${projectKey(projectName)}-${task.seq || '?'}`
}

/** Ссылка на элемент иерархии для крошек связанного чата. */
export interface TaskChatCrumb {
  id: string
  title: string
  /** Ключ вида `PRJ-42`. */
  key: string
}

/**
 * Контекст задачи для чата, привязанного к ней (`conversations.task_id`):
 * иерархия, этап воркфлоу, машина и папка разработки, последний CI-ран.
 * `null`, если чат не привязан к задаче.
 */
export interface TaskChatContext {
  /**
   * Чат, которому принадлежит контекст. Виджет задачи рисуется только когда id
   * совпадает с открытым чатом: контекст — свойство чата, а не залипающее
   * состояние стора, и медленный ответ на закрытый чат ничего не показывает.
   */
  conversationId: string
  projectId: string
  projectName: string
  epic: TaskChatCrumb | null
  story: TaskChatCrumb | null
  task: TaskChatCrumb & { type: WorkItemType }
  /** Подпись колонки и её машинный смысл — этап жизненного цикла разработки. */
  columnName: string
  columnSemantic: KanbanColumnSemanticType | null
  agentId: string | null
  agentName: string | null
  /** Рабочая директория, в которой идёт разработка. */
  workdir: string | null
  run: {
    id: string
    status: CiStatus
    mode: CiRunMode
    startedAt: number | null
    durationMs: number | null
  } | null
}

/**
 * Метка чата, привязанного к задаче, для списка бесед: ключ задачи, её тип и
 * последний CI-ран. Ран отдаётся той же сводкой, что подсвечивает карточку на
 * доске — список чатов и канбан показывают одно состояние одними цветами.
 * Дальше сводку обновляют живые кадры `ci.*` (они приходят на все соединения
 * пользователя, а не только подписчикам доски).
 */
export interface TaskChatBadge {
  conversationId: string
  projectId: string
  taskId: string
  /** Ключ вида `PRJ-42`. */
  key: string
  type: WorkItemType
  /** Текущая колонка задачи: нужна, чтобы ручное завершение сильнее старой ошибки рана. */
  columnSemantic: KanbanColumnSemanticType | null
  run: CiRunSummary | null
}

/** Снапшот доски проекта. */
export interface Board {
  columns: KanbanColumn[]
  tasks: Task[]
  /** Сводки CI-ранов по задачам проекта (последний ран на задачу). */
  ciRuns?: CiRunSummary[]
}
