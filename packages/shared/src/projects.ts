export const MACHINE_STORAGE_FORMAT_VERSION = 1

export type MachineStorageStatus = 'ready' | 'read-only' | 'offline' | 'unavailable'

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

/** Каталоги чата внутри корня MachineStorage (разделитель — как в корне: Windows-корень даёт `\`). */
export interface ChatStorageDirectories {
  chatRoot: string
  attachments: string
  artifacts: string
  generated: string
}

/** Привязка чата к хранилищу вместе с абсолютными путями — то, что видит пользователь в карточке чата. */
export interface ChatStorageView extends ChatStorageBinding {
  /** Корень хранилища; отсутствует, если хранилище удалено с машины/из БД. */
  rootPath?: string
  status?: MachineStorageStatus
  directories?: ChatStorageDirectories
}

export function chatStorageDirectories(rootPath: string, relativePath: string): ChatStorageDirectories {
  const root = rootPath.trim().replace(/[/\\]+$/, '')
  if (!root) throw new Error('Корень MachineStorage не задан')
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  // Базовый путь проверяется один раз; служебные подкаталоги (`.generated`) вне правил validateStorageRelativePath.
  const chatRoot = `${root}${separator}${validateStorageRelativePath(relativePath).replace(/\//g, separator)}`
  return { chatRoot, attachments: `${chatRoot}${separator}attachments`, artifacts: `${chatRoot}${separator}artifacts`, generated: `${chatRoot}${separator}.generated` }
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

export type ManagedEnvironmentKind = 'production' | 'staging' | 'test' | 'preview'

export const PROJECT_WORKSPACE_MANIFEST_FORMAT_VERSION = 1
export type WorkspaceMode = 'shared_main' | 'chat_workspace' | 'task_workspace' | 'legacy'
export type WorkspaceState = 'ready' | 'refreshing' | 'creating' | 'merge_pending' | 'merge_failed' | 'blocked' | 'unavailable'

export interface WorkspaceView {
  mode: WorkspaceMode
  baseSha: string | null
  branch: string | null
  path: string | null
  readOnly: boolean
  state: WorkspaceState
  diagnostic: string | null
}

export interface ProjectWorkspaceManifest {
  formatVersion: typeof PROJECT_WORKSPACE_MANIFEST_FORMAT_VERSION
  kind: 'project_main' | 'chat_workspace'
  projectId: string
  machineId: string
  storageId: string
  canonicalPath: string
  origin: string
  branch: string
  conversationId?: string
  baseSha?: string
}

export interface ManagedChatWorkspacePaths {
  root: string
  repository: string
  manifest: string
}

/** Canonical isolated workspace for a normal project conversation. */
export function managedChatWorkspacePaths(storageRoot: string, projectId: string, conversationId: string, platform: string): ManagedChatWorkspacePaths {
  const root = normalizeMachineStoragePath(storageRoot, platform)
  const separator = machinePathSeparator(platform)
  const workspace = [root, 'projects', validateStorageRelativePath(projectId), 'chats', validateStorageRelativePath(conversationId), 'workspace'].join(separator)
  if (!isPathInsideMachineStorage(workspace, root, platform)) throw new Error('Chat workspace path выходит за границы storage')
  return { root: workspace, repository: `${workspace}${separator}repository`, manifest: `${workspace}${separator}workspace.json` }
}

export const PROJECT_MACHINE_DIRECTORY_KINDS = [
  'projectWorkdir', 'reposRoot', 'mergeClones', 'production', 'staging',
  'featurePreview', 'taskWorkspace'
] as const
export type ProjectMachineDirectoryKind = typeof PROJECT_MACHINE_DIRECTORY_KINDS[number]

export interface ProjectMachineDirectoryAssignment {
  path: string
  override: boolean
}

export type ProjectMachineDirectoryAssignments = Record<ProjectMachineDirectoryKind, ProjectMachineDirectoryAssignment>

const PROJECT_MACHINE_DIRECTORY_SEGMENTS: Record<ProjectMachineDirectoryKind, readonly string[]> = {
  projectWorkdir: ['worktree'],
  reposRoot: ['repositories'],
  mergeClones: ['merge-clones'],
  production: ['environments', 'production'],
  staging: ['environments', 'staging'],
  featurePreview: ['environments', 'previews'],
  taskWorkspace: ['tasks']
}

function machinePathSeparator(platform: string): '/' | '\\' {
  return platform === 'win32' ? '\\' : '/'
}

/** Absolute canonical recommendation rooted in one registered MachineStorage. */
export function recommendedProjectMachineDirectory(
  storageRoot: string,
  projectId: string,
  kind: ProjectMachineDirectoryKind,
  platform: string
): string {
  const root = normalizeMachineStoragePath(storageRoot, platform)
  const separator = machinePathSeparator(platform)
  return [root, 'projects', validateStorageRelativePath(projectId), ...PROJECT_MACHINE_DIRECTORY_SEGMENTS[kind]].join(separator)
}

export function recommendedProjectMachineDirectories(
  storageRoot: string,
  projectId: string,
  platform: string
): Record<ProjectMachineDirectoryKind, string> {
  return Object.fromEntries(PROJECT_MACHINE_DIRECTORY_KINDS.map((kind) => [
    kind, recommendedProjectMachineDirectory(storageRoot, projectId, kind, platform)
  ])) as Record<ProjectMachineDirectoryKind, string>
}

export function normalizeProjectMachineDirectory(path: string, platform: string): string {
  return normalizeMachineStoragePath(path, platform)
}

export interface ManagedMergeClonePaths {
  root: string
  repository: string
  npmCache: string
}

/** Постоянный merge-клон проекта, изолированный от taskWorkspace и остальных назначений. */
export function managedMergeClonePaths(storageRoot: string, projectId: string, platform: string): ManagedMergeClonePaths {
  const root = recommendedProjectMachineDirectory(storageRoot, projectId, 'mergeClones', platform)
  const separator = machinePathSeparator(platform)
  return {
    root,
    repository: `${root}${separator}repository`,
    npmCache: `${root}${separator}npm-cache`
  }
}

export function isPathInsideMachineStorage(path: string, storageRoot: string, platform: string): boolean {
  const candidate = normalizeProjectMachineDirectory(path, platform)
  const root = normalizeMachineStoragePath(storageRoot, platform)
  const fold = (value: string): string => platform === 'win32' ? value.toLowerCase() : value
  return fold(candidate).startsWith(fold(root) + machinePathSeparator(platform))
}

export function validateProjectMachineDirectories(
  assignments: ProjectMachineDirectoryAssignments,
  storageRoot: string,
  projectId: string,
  platform: string
): ProjectMachineDirectoryAssignments {
  const recommendations = recommendedProjectMachineDirectories(storageRoot, projectId, platform)
  const normalized = {} as ProjectMachineDirectoryAssignments
  const occupied = new Map<string, ProjectMachineDirectoryKind>()
  const separator = machinePathSeparator(platform)
  for (const kind of PROJECT_MACHINE_DIRECTORY_KINDS) {
    const assignment = assignments[kind]
    if (!assignment) throw new Error(`Не задан каталог «${kind}»`)
    const path = normalizeProjectMachineDirectory(assignment.path, platform)
    if (!assignment.override && path !== recommendations[kind]) throw new Error(`Managed-каталог «${kind}» не совпадает с рекомендацией`)
    if (!assignment.override && !isPathInsideMachineStorage(path, storageRoot, platform)) throw new Error(`Managed-каталог «${kind}» выходит за границы storage`)
    const key = platform === 'win32' ? path.toLowerCase() : path
    const conflict = [...occupied.entries()].find(([other]) => key === other || key.startsWith(other + separator) || other.startsWith(key + separator))
    if (conflict) throw new Error(`Каталоги «${conflict[1]}» и «${kind}» совпадают или пересекаются`)
    occupied.set(key, kind)
    normalized[kind] = { path, override: assignment.override }
  }
  return normalized
}

export function recommendedEnvironmentPath(projectId: string, kind: 'production' | 'staging'): string {
  return `projects/${validateStorageRelativePath(projectId)}/environments/${kind}`
}

export interface ManagedEnvironmentPaths {
  root: string
  app: string
  config: string
  logs: string
  artifacts: string
  temporary: string
  repository: string
  manifest: string
}

/** Canonical production/staging layout; callers never append repository paths themselves. */
export function managedEnvironmentPaths(
  storageRoot: string,
  projectId: string,
  kind: 'production' | 'staging',
  platform: string
): ManagedEnvironmentPaths {
  const root = recommendedProjectMachineDirectory(storageRoot, projectId, kind, platform)
  if (!isPathInsideMachineStorage(root, storageRoot, platform)) throw new Error('Managed environment path выходит за границы storage')
  const separator = machinePathSeparator(platform)
  const child = (name: string): string => `${root}${separator}${name}`
  const temporary = child('temporary')
  return { root, app: child('app'), config: child('config'), logs: child('logs'), artifacts: child('artifacts'), temporary, repository: `${temporary}${separator}repository`, manifest: child('environment.json') }
}

export function recommendedPreviewEnvironmentPath(projectId: string, taskId: string, previewId: string): string {
  return `projects/${validateStorageRelativePath(projectId)}/tasks/${validateStorageRelativePath(taskId)}/environments/preview/${validateStorageRelativePath(previewId)}`
}

export interface ManagedPreviewEnvironmentPaths {
  previewRoot: string
  app: string
  config: string
  logs: string
  artifacts: string
  temporary: string
  repository: string
  manifest: string
}

/** Absolute canonical preview layout in the target machine path syntax. */
export function managedPreviewEnvironmentPaths(storageRoot: string, projectId: string, taskId: string, previewId: string, platform: string): ManagedPreviewEnvironmentPaths {
  const root = normalizeMachineStoragePath(storageRoot, platform)
  const separator = machinePathSeparator(platform)
  const relative = recommendedPreviewEnvironmentPath(projectId, taskId, previewId).split('/')
  const previewRoot = [root, ...relative].join(separator)
  if (!isPathInsideMachineStorage(previewRoot, root, platform)) throw new Error('Managed preview path выходит за границы storage')
  const child = (name: string): string => `${previewRoot}${separator}${name}`
  const temporary = child('temporary')
  return {
    previewRoot,
    app: child('app'),
    config: child('config'),
    logs: child('logs'),
    artifacts: child('artifacts'),
    temporary,
    repository: `${temporary}${separator}repository`,
    manifest: child('environment.json')
  }
}

export function recommendedTaskTestEnvironmentPath(projectId: string, taskId: string): string {
  return `projects/${validateStorageRelativePath(projectId)}/tasks/${validateStorageRelativePath(taskId)}/environments/test`
}

export interface ManagedRunManifestPaths { root: string; run: string; report: string }
/** Canonical immutable manifest directory inside a managed environment. */
export function managedRunManifestPaths(environmentRoot: string, runId: string, platform: string): ManagedRunManifestPaths {
  const root = normalizeMachineStoragePath(environmentRoot, platform)
  const separator = machinePathSeparator(platform)
  const runRoot = `${root}${separator}runs${separator}${validateStorageRelativePath(runId)}`
  return { root: runRoot, run: `${runRoot}${separator}run.json`, report: `${runRoot}${separator}report.json` }
}

export interface ManagedCiWorkspacePaths {
  environment: string
  repoRoot: string
  repository: string
  workspace: string
  npmCacheRoot: string
  npmCacheDir: string
}

/** Строит managed CI layout в синтаксисе пути самой машины. */
export function managedCiWorkspacePaths(storageRoot: string, projectId: string, taskId: string, taskKey: string): ManagedCiWorkspacePaths {
  const root = storageRoot.trim().replace(/[\\/]+$/, '')
  if (!root) throw new Error('MachineStorage rootPath required')
  const separator = /^(?:[A-Za-z]:\\|\\\\)/.test(root) || (root.includes('\\') && !root.includes('/')) ? '\\' : '/'
  const join = (...segments: string[]): string => [root, ...segments.map(validateStorageRelativePath)].join(separator)
  const environment = join('projects', projectId, 'tasks', taskId, 'environments', 'test')
  const repoRoot = `${environment}${separator}temporary`
  const repository = `${repoRoot}${separator}repository`
  const workspace = `${repository}${separator}${validateStorageRelativePath(taskKey)}`
  const npmCacheRoot = `${repoRoot}${separator}.npm-cache`
  return { environment, repoRoot, repository, workspace, npmCacheRoot, npmCacheDir: `${npmCacheRoot}${separator}${validateStorageRelativePath(taskKey)}` }
}

/** Постоянные каталоги окружения не пересекаются с восстанавливаемым checkout. */
export const MANAGED_ENVIRONMENT_DIRECTORIES = ['app', 'config', 'logs', 'artifacts', 'temporary/repository'] as const

export function managedChatAttachmentsPath(relativePath: string): string {
  return `${validateStorageRelativePath(relativePath)}/attachments`
}

export function managedChatArtifactsPath(relativePath: string): string {
  return `${validateStorageRelativePath(relativePath)}/artifacts`
}

export function managedChatTemporaryPath(relativePath: string): string {
  return `${validateStorageRelativePath(relativePath)}/.generated`
}

import type { CiRunSummary, CiReuseStrategy, CiStatus, CiRunMode } from './ci'
import type { ProjectTypeChain } from './projectTypes'
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
  component_qa: ['integration_tests', 'development', 'preparation', 'decision_required'],
  integration_tests: ['automated_qa', 'development', 'preparation', 'decision_required'],
  automated_qa: ['manual_qa', 'integration_tests', 'development', 'preparation', 'decision_required'],
  manual_qa: ['awaiting_merge', 'development', 'preparation', 'decision_required'],
  awaiting_merge: ['merge', 'component_qa', 'automated_qa', 'preparation', 'decision_required'],
  merge: ['done', 'preparation', 'decision_required'],
  done: ['preparation'],
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

/** Тестовая учётная запись окружения проекта (не production-секрет). */
export interface ProjectTestUser {
  name: string
  password: string
  /** Роль в тестируемом приложении ('admin', 'user', …) — свободный текст. */
  role?: string
  /** Пояснение, что доступно этой учётке. */
  note?: string
}

const TEST_USER_FIELD_LIMIT = 200
const TEST_USERS_LIMIT = 32

/**
 * Валидация списка тестовых пользователей на границе REST: непустое имя,
 * строковый пароль, ограниченные длины и размер списка. Бросает при мусоре.
 */
export function sanitizeProjectTestUsers(value: unknown): ProjectTestUser[] {
  if (!Array.isArray(value)) throw new Error('testUsers must be an array')
  if (value.length > TEST_USERS_LIMIT) throw new Error(`testUsers: не больше ${TEST_USERS_LIMIT} записей`)
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) throw new Error('testUsers: запись должна быть объектом')
    const raw = item as { name?: unknown; password?: unknown; role?: unknown; note?: unknown }
    const text = (field: string, input: unknown, required = false): string | undefined => {
      if (input === undefined || input === null || input === '') {
        if (required) throw new Error(`testUsers: поле ${field} обязательно`)
        return undefined
      }
      if (typeof input !== 'string' || input.length > TEST_USER_FIELD_LIMIT) throw new Error(`testUsers: некорректное поле ${field}`)
      return input
    }
    const name = text('name', raw.name, true)!
    if (!name.trim()) throw new Error('testUsers: поле name обязательно')
    const password = typeof raw.password === 'string' && raw.password.length <= TEST_USER_FIELD_LIMIT ? raw.password : undefined
    if (password === undefined) throw new Error('testUsers: некорректное поле password')
    const role = text('role', raw.role)
    const note = text('note', raw.note)
    return { name, password, ...(role !== undefined ? { role } : {}), ...(note !== undefined ? { note } : {}) }
  })
}

/**
 * Проект в списке. `role` — роль текущего пользователя (запрос знает uid),
 * технологии/навыки — свободные теги.
 */
export const DEFAULT_OWNED_PROJECT_LIMIT = 5

/** Квота собственных проектов текущего пользователя; admin получает unlimited. */
export interface ProjectQuota {
  owned: number
  limit: number
  unlimited: boolean
}

export interface ProjectSummary {
  id: string
  name: string
  description: string
  /** Узел дерева типов (`project_types.id`); определяет доступные подсистемы. */
  typeId: string
  /**
   * Разрешённая цепочка типа с эффективными возможностями. Отдаётся всегда, даже
   * если сам узел — личный узел владельца: остальные участники обязаны видеть имя
   * типа и знать, какие разделы проекта включены.
   */
  typeChain: ProjectTypeChain
  gitUrl: string | null
  /** Адрес веб-превью по умолчанию для чатов проекта. */
  previewUrl?: string | null
  /**
   * Тестовые учётные записи для входа в тестовые окружения проекта из Web
   * Reader. Это заведомо не-production креды: модель получает их MCP-инструментом
   * `test-users`, чтобы логиниться в окружении и проверять фичи под ролями.
   */
  testUsers?: ProjectTestUser[]
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
  /** Политика команд проекта поверх политик машин (machines-roadmap п.10); нет — дефолт (`DEFAULT_PROJECT_COMMAND_POLICY`). */
  commandPolicy?: import('./commandPolicy').ProjectCommandPolicy
  mergeTransport: 'local' | 'github_pull_request'
  agentPlanApprovalMode: 'manual' | 'automatic'
  testCommand?: string
  /**
   * Команды пост-development стадий. Пустое значение наследует `testCommand`,
   * поэтому старые проекты работают как раньше. Смысл раздельных настроек в
   * том, что Component QA нужны компонентные проверки, а интеграционному этапу —
   * только новые интеграционные тесты: до разделения обе стадии гоняли полный
   * гейт монорепо на коде, который уже прошёл его в разработке.
   */
  componentQaCommand?: string
  integrationTestCommand?: string
  /** Команда полного Automated QA; пустое значение использует `npm test`. */
  automatedQaCommand?: string
  /** Способ исполнения этапа Automated QA; по умолчанию `command`. */
  automatedQaMode?: import('./qa').AutomatedQaMode
  /**
   * Сценарии браузерной проверки для режима `playwright`. Набор, а не один:
   * «много автотестов» упиралось именно в единственный сценарий на проект.
   */
  automatedQaScenarios?: import('./qa').AutomatedQaScenario[]
  /**
   * Включать автопроход у новых карточек-задач. Флаг живёт на самой карточке, и
   * пока его приходилось ставить руками каждой задаче, конвейер всё равно
   * начинался с действия человека — ровно того, чего автопроход избегает.
   */
  autoPilotDefault?: boolean
  /** Остановить автопроход перед manual_qa. */
  autoPilotRequiresManualQa?: boolean
  /** Максимум автоматических возвратов на доработку. */
  autoPilotFixLimit?: number
  productionDeployCommand?: string
  /** Отдельная машина, с которой разрешён только production deploy. */
  productionAgentId?: string | null
  /** Existing records default to explicit legacy compatibility. */
  productionEnvironmentMode?: 'legacy' | 'managed'
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
  /** Уровень доступа, с которым владелец предоставил машину проекту (п.18); нет — не предоставлена. */
  shareAccess?: import('./agentProtocol').MachineShareAccess
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
  /** Выбранное зарегистрированное хранилище и единая схема каталогов. */
  storageId?: string | null
  storage?: MachineStorage | null
  /** Все зарегистрированные хранилища этой машины; primary/ready выбирается первым. */
  availableStorages?: MachineStorage[]
  directories?: ProjectMachineDirectoryAssignments
  recommendations?: Record<ProjectMachineDirectoryKind, string>
  readiness?: { ready: boolean; reasons: string[] }
  /** Явно настроенный SSH hostname/IP для ручного preview-туннеля. */
  sshHost?: string
  /** Явно настроенный SSH-пользователь для ручного preview-туннеля. */
  sshUser?: string
}

/** Состояние приглашения в проект. */
export type ProjectInvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked'

/**
 * Приглашение участника — как на GitHub: владелец зовёт по логину или адресу,
 * уходит письмо, приглашённый подтверждает сам. Токен наружу отдаётся только в
 * письме; в API его нет — в списках он не нужен, а утечка равна доступу.
 */
export interface ProjectInvitation {
  id: string
  projectId: string
  /** Адрес, на который отправлено письмо (или null, если звали по логину). */
  email: string | null
  /** Логин приглашённого, если он известен системе. */
  invitedUsername: string | null
  role: ProjectRole
  status: ProjectInvitationStatus
  invitedBy: string
  createdAt: number
  expiresAt: number
  respondedAt: number | null
}

/**
 * Что видит неавторизованный по ссылке из письма. Намеренно только три поля:
 * имя проекта, кто позвал и срок — этого хватает, чтобы понять, куда идёшь.
 */
export interface ProjectInvitationPreview {
  projectId: string
  projectName: string
  invitedBy: string
  role: ProjectRole
  expiresAt: number
}

/** Приглашение вместе с именем проекта — для списка «мои приглашения». */
export interface ProjectInvitationForUser extends ProjectInvitation {
  projectName: string
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

/**
 * Связь карточки с дизайном, собранным в Make: конкретная страница Make-проекта,
 * привязанного к тому же проекту. Связь адресует **живой** проект, а не снимок:
 * дизайн правится дальше, и карточка должна показывать текущее состояние экрана.
 */
export interface TaskDesignLink {
  id: string
  taskId: string
  /** Разговор вида `make` — он же проект дизайна; привязан к проекту задачи. */
  conversationId: string
  /** Имя Make-проекта на момент выдачи: список связей не должен ждать загрузки чатов. */
  conversationTitle: string
  /** Владелец Make-проекта (логин): дизайн может быть заведён другим участником. */
  conversationOwner: string | null
  /** Явный режим доступа: весь проект либо точный набор файлов. */
  mode: 'whole_project' | 'files'
  /** Канонические уникальные пути в детерминированном порядке; пусто только для whole_project. */
  paths: string[]
  /** Legacy-представление для обратной панели Make: первый путь либо пустая строка. */
  path: string
  /** Актуальная доступность каждого сохранённого пути (вычисляется сервером). */
  fileStatuses?: Array<{ path: string; available: boolean; error?: string }>
  /** Подпись экрана; пусто — показываем путь. */
  label: string
  createdAt: number
  /** Логин связавшего; null у legacy-строк. */
  createdBy: string | null
}

/** Make-проект, доступный проекту как источник дизайна (выбор в карточке). */
export interface ProjectDesignSource {
  conversationId: string
  title: string
  owner: string | null
  /** Свой проект пользователя; чужой доступен только на чтение. */
  own: boolean
  updatedAt: number
}

/** Карточка проекта для выбора в диалоге «Связать с задачей» панели Make. */
export interface MakeLinkableTask {
  taskId: string
  projectId: string
  taskKey: string
  title: string
  columnName: string | null
}

/** Задача проекта, ссылающаяся на страницу Make-проекта (обратная связь в панели Make). */
export interface MakeTaskLink {
  id: string
  taskId: string
  projectId: string
  /** Ключ вида `PRJ-42` собирает сервер: панель Make не знает имени проекта. */
  taskKey: string
  taskTitle: string
  columnName: string | null
  path: string
  label: string
  createdAt: number
}

/**
 * Строки блока «Дизайн» для промпта модели: где лежит макет и что открыть.
 * Общие у хода чата и у CI-рана — иначе они разъедутся, как когда-то контекст проекта.
 */
export interface TaskMakeSource {
  name: string
  conversationId: string
  title: string
  mode: 'whole_project' | 'files'
  paths: string[]
  fileStatuses?: Array<{ path: string; available: boolean; error?: string }>
}

/** Один детерминированный точный источник на Make-проект. */
export function taskMakeSources(designs: TaskDesignLink[]): TaskMakeSource[] {
  return [...designs]
    .sort((a, b) => a.conversationId.localeCompare(b.conversationId))
    .map((design, index) => ({
      name: `make_design_${index + 1}`,
      conversationId: design.conversationId,
      title: design.label || design.conversationTitle,
      mode: design.mode,
      paths: [...new Set(design.paths)].sort((a, b) => a.localeCompare(b)),
      ...(design.fileStatuses ? { fileStatuses: [...design.fileStatuses].sort((a, b) => a.path.localeCompare(b.path)) } : {})
    }))
}

export function designPromptLines(designs: TaskDesignLink[], _previewUrl?: (conversationId: string, path: string) => string): string[] {
  return taskMakeSources(designs).map((source) => {
    const where = source.mode === 'whole_project' ? 'проект целиком' : `точные файлы: ${source.paths.join(', ')}`
    return `Дизайн: «${source.title}» — Make-проект ${source.conversationId}, ${where}; чтение через ${source.name}.make_read_file`
  })
}

export interface TaskAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  status: 'ready' | 'missing'
}

export interface TaskReworkMakeSource {
  conversationId: string
  title: string
  mode: 'whole_project' | 'files'
  paths: string[]
}

export interface TaskReworkCycle {
  id: string
  taskId: string
  sequence: number
  description: string
  criteria: string[]
  makeSources: TaskReworkMakeSource[]
  attachments: TaskAttachment[]
  implementedResult?: string
  createdBy: string
  createdAt: number
  preparationRunId: string | null
}

export interface CreateTaskReworkCycleInput {
  description: string
  criteria?: string[]
  makeMode: 'whole_project' | 'files'
  makePaths?: string[]
  makeSources?: TaskReworkMakeSource[]
  uploadIds?: string[]
  idempotencyKey: string
}

/** Задача канбан-доски. Статус задачи = её колонка (columnId). */
export interface Task {
  id: string
  projectId: string
  columnId: string
  type: WorkItemType
  parentId: string | null
  /** Исходная задача для карточки, созданной из предложения улучшения. */
  sourceTaskId?: string | null
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
  /** Карточка автоматически проходит development и QA-конвейер. */
  autoPilot?: boolean
  /** Уже использованные автоматические круги доработки. */
  autoPilotFixCycles?: number
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
  /**
   * Связанные дизайны из Make. Заполняется в подробной карточке и в контексте
   * CI-рана; в снапшоте доски и в ответах create/update — undefined.
   */
  designs?: TaskDesignLink[]
  /** Последний актуальный результат всех серверных этапов; отсутствие данных не является ошибкой. */
  latestRunResult?: TaskRunResult | null
  /** Подтверждённые исходные вложения задачи. */
  attachments?: TaskAttachment[]
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

/**
 * Граница `doneAt`, начиная с которой завершённая задача ещё видна на доске:
 * то же правило, что и `isCompletedHidden`, но пригодное для условия в SQL —
 * доска не должна вычитывать всю колонку «Готово», чтобы отбросить её в памяти.
 * `null` — отсечения нет (порог не задан).
 */
export function completedVisibilityCutoff(retentionDays: number | null | undefined, now: number): number | null {
  if (retentionDays == null || !Number.isFinite(retentionDays) || retentionDays < 0) return null
  // Порог 0 — «убрать в конце дня завершения»: сегодняшние остаются до полуночи.
  if (retentionDays === 0) return startOfDay(now)
  // isCompletedHidden прячет при now - doneAt >= r*DAY, значит видима строго правее.
  return now - retentionDays * DAY_MS + 1
}

/**
 * Локальный понедельник 00:00 — граница «свежих» бесед. Сайдбар делит список на
 * текущую неделю и «Более старые», и та же метка служит окном первой страницы:
 * старое не грузится, пока секцию не раскроют.
 */
export function localWeekStart(now: number): number {
  const date = new Date(now)
  const daysFromMonday = (date.getDay() + 6) % 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - daysFromMonday)
  return date.getTime()
}

/** Сколько старых бесед приносит одна догрузка секции «Более старые». */
export const OLDER_CONVERSATIONS_PAGE = 20

/** Полночь текущего дня для `ts` (тот же часовой пояс, что и `endOfDay`). */
function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
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
 * колонка. Список чатов и канбан показывают одно состояние одними цветами.
 *
 * Сводка рана по умолчанию **не приезжает**: она весила 91% ответа (полная
 * раскладка шагов с прогнозами, которую список чатов не рисует) и стоила по
 * пять запросов на метку. Её отдаёт только явный `withRuns`; дальше состояние
 * обновляют живые кадры `ci.*` и вторая фаза доски.
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
  /** Есть только у запроса с `withRuns`; иначе поля нет вовсе. */
  run?: CiRunSummary | null
}

/** Снапшот доски проекта. */
export interface Board {
  columns: KanbanColumn[]
  tasks: Task[]
  /** Сводки CI-ранов по задачам проекта (последний ран на задачу). */
  ciRuns?: CiRunSummary[]
}

/**
 * Состояние процессов одной карточки: вторая фаза загрузки доски. Первая фаза
 * отдаёт скелет (что за карточка и в какой колонке), эта — что с ней сейчас
 * происходит. Разделение сделано ради старта: скелет — один запрос к `tasks`,
 * а состояние собирается по восьми таблицам ранов и приезжает следом.
 */
export interface TaskStatus {
  taskId: string
  /** Id связанного чата текущего пользователя (или null). */
  chatId: string | null
  mergeSourceBranch: string | null
  mergeSourceSha: string | null
  activeMergeRunId: string | null
  latestMergeRunId: string | null
  activeMergeStatus: string | null
  mergePermitted: boolean
  mergeMachineBound: boolean
  mergedSha: string | null
  mergedSourceSha: string | null
  taskPreparationRunId: string | null
  taskPreparationStatus: import('./qa').TaskPreparationStatus | null
  taskPreparationError: string | null
  latestRunResult: TaskRunResult | null
}

/** Ответ второй фазы: состояние карточек и сводки CI-ранов доски. */
export interface BoardStatuses {
  tasks: TaskStatus[]
  ciRuns: CiRunSummary[]
}

/**
 * Накладывает состояние процессов на скелет карточек. Задачи без записи в
 * `statuses` остаются как есть: вторая фаза могла не успеть (доска уже
 * перерисовалась) или карточку создали между фазами — рисовать её без состояния
 * правильнее, чем гасить уже показанное.
 */
export function applyTaskStatuses(tasks: Task[], statuses: TaskStatus[]): Task[] {
  if (statuses.length === 0) return tasks
  const byTask = new Map(statuses.map((status) => [status.taskId, status]))
  return tasks.map((task) => {
    const status = byTask.get(task.id)
    if (!status) return task
    const { taskId: _taskId, ...fields } = status
    return { ...task, ...fields }
  })
}

/**
 * Вид доски конкретного человека в конкретном проекте: фильтры и раскладка.
 * Живёт на сервере, а не в браузере, — иначе настроенная доска «сбрасывается»
 * на другом компьютере или в очищенном профиле.
 */
export interface BoardView {
  search: string
  assignees: string[]
  types: WorkItemType[]
  priorities: TaskPriority[]
  labels: string[]
  epics: string[]
  onlyMine: boolean
  flaggedOnly: boolean
  recentOnly: boolean
  /** Фильтр исполнителей по колонкам: id колонки → выбор. */
  columnAssignees: Record<string, { assigneeIds: string[]; unassigned: boolean }>
  swimlane: 'none' | 'epic' | 'assignee'
  showHidden: boolean
  showCompleted: boolean
}

export const DEFAULT_BOARD_VIEW: BoardView = {
  search: '',
  assignees: [],
  types: [],
  priorities: [],
  labels: [],
  epics: [],
  onlyMine: false,
  flaggedOnly: false,
  recentOnly: false,
  columnAssignees: {},
  swimlane: 'none',
  showHidden: false,
  showCompleted: false
}

/**
 * Приводит присланный вид к контракту: как и у настроек, мусорное значение не
 * должно осесть в записи — она хранится одной JSON-строкой и мержится.
 */
export function sanitizeBoardView(raw: unknown): Partial<BoardView> {
  if (typeof raw !== 'object' || raw === null) return {}
  const input = raw as Record<string, unknown>
  const view: Record<string, unknown> = {}
  if (typeof input.search === 'string') view.search = input.search.slice(0, 200)
  const strings = (value: unknown): string[] | null =>
    Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]).slice(0, 200) : null
  for (const key of ['assignees', 'labels', 'epics'] as const) {
    const list = strings(input[key])
    if (list) view[key] = list
  }
  const types = strings(input.types)?.filter((item): item is WorkItemType => (WORK_ITEM_TYPES as readonly string[]).includes(item))
  if (types) view.types = types
  const priorities = strings(input.priorities)?.filter((item): item is TaskPriority => (TASK_PRIORITIES as readonly string[]).includes(item))
  if (priorities) view.priorities = priorities
  for (const key of ['onlyMine', 'flaggedOnly', 'recentOnly', 'showHidden', 'showCompleted'] as const) {
    if (typeof input[key] === 'boolean') view[key] = input[key]
  }
  if (input.swimlane === 'none' || input.swimlane === 'epic' || input.swimlane === 'assignee') view.swimlane = input.swimlane
  if (typeof input.columnAssignees === 'object' && input.columnAssignees !== null) {
    const entries = Object.entries(input.columnAssignees as Record<string, unknown>).flatMap(([columnId, value]) => {
      if (typeof value !== 'object' || value === null) return []
      const filter = value as { assigneeIds?: unknown; unassigned?: unknown }
      const assigneeIds = strings(filter.assigneeIds) ?? []
      return [[columnId, { assigneeIds, unassigned: filter.unassigned === true }]] as const
    })
    view.columnAssignees = Object.fromEntries(entries)
  }
  return view as Partial<BoardView>
}

// ---------------------------------------------------------------------------
// Активность карточки как в Jira: комментарии, ворклог и история изменений.
// Комментарии добавляют и правят и человек, и модель канбан-ассистента (via
// различает их в ленте); историю пишет сервер сам при изменении полей.

/** Кем внесена запись: человеком напрямую или моделью ассистента от его имени. */
export type TaskActivityVia = 'user' | 'model'

export interface TaskComment {
  id: string
  taskId: string
  author: string
  via: TaskActivityVia
  text: string
  createdAt: number
  /** null — не правился; правка помечается «изменён» в ленте, как в Jira. */
  updatedAt: number | null
}

export interface TaskWorklogEntry {
  id: string
  taskId: string
  author: string
  /** Затраченное время в минутах; UI показывает «2 ч 30 м». */
  minutes: number
  comment: string
  /** Когда работа была сделана (задаёт автор), а не когда запись создана. */
  startedAt: number
  createdAt: number
  updatedAt: number | null
}

export interface TaskHistoryEvent {
  id: string
  taskId: string
  actor: string
  via: TaskActivityVia
  /** Код поля: title, description, acceptanceCriteria, column, assignee, priority, … */
  field: string
  from: string | null
  to: string | null
  at: number
}

/** Снимок вкладки «Активность»: три ленты одним запросом. */
export interface TaskActivity {
  comments: TaskComment[]
  worklog: TaskWorklogEntry[]
  history: TaskHistoryEvent[]
  /** Сумма ворклога в минутах — итог считает сервер, а не каждый клиент. */
  totalMinutes: number
}
