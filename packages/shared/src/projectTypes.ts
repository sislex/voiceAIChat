// Тип проекта — узел дерева с наследованием, а не enum. Пользователь выбирает тип
// («Разработка ПО») и подтип («Веб-приложение»), может сохранить настроенный проект
// как новый подтип и так вглубь. У узла две разные по смыслу части:
//
//   • возможности (features) — политика. Читаются ЖИВЬЁМ: правка типа сразу меняет
//     доступные разделы у всех его проектов, и по ним же отказывает сервер.
//   • заготовки (defaults) — стартовая точка. Копируются в проект ОДИН РАЗ, при
//     создании; иначе правка типа задним числом перекроила бы работающие доски.
//
// Разрешение обеих частей — фолд от корня к листу. Массивы при слиянии заменяются
// целиком, а не склеиваются: иначе ребёнок не смог бы сократить набор родителя.

import type { KanbanColumnSemanticType, WorkItemDefaultSkills } from './projects'
import type { CiReuseStrategy } from './ci'

/** Подсистема проекта, которую тип может включить или выключить. */
export type ProjectFeature = 'git' | 'machines' | 'ci' | 'qa' | 'releases' | 'preview'

export const PROJECT_FEATURES: readonly ProjectFeature[] = ['git', 'machines', 'ci', 'qa', 'releases', 'preview']

/** Человеческое описание возможностей — для подсказок в настройках типа. */
export const PROJECT_FEATURE_LABELS: Readonly<Record<ProjectFeature, string>> = {
  git: 'Git-репозиторий, политика коммитов и merge',
  machines: 'Машины проекта, папки и хранилища',
  ci: 'CI-раны, подготовка задач и улучшения',
  qa: 'QA-этапы: component, интеграционные, automated, ручное',
  releases: 'Релизы и production-деплой',
  preview: 'Веб-превью, feature-preview и тестовые пользователи'
}

/** Частичное переопределение: отсутствие ключа = наследовать у родителя. */
export type ProjectFeatureOverride = Partial<Record<ProjectFeature, boolean>>

/** Полностью разрешённый набор — то, чем пользуются UI и серверный гейт. */
export type ProjectFeatureSet = Readonly<Record<ProjectFeature, boolean>>

/** Заготовки для нового проекта этого типа. */
export interface ProjectTypeDefaults {
  /** Колонки доски; пусто — взять родительские, а если и там пусто, то системные. */
  columns?: { name: string; semanticType: KanbanColumnSemanticType }[]
  technologies?: string[]
  skills?: string[]
  defaultSkills?: Partial<WorkItemDefaultSkills>
  commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'
  mergeTransport?: 'local' | 'github_pull_request'
  agentPlanApprovalMode?: 'manual' | 'automatic'
  ciBaseBranch?: string
  ciBranchTemplate?: string
  ciReuseStrategy?: CiReuseStrategy
  doneRetentionDays?: number | null
  testCommand?: string
}

/**
 * Статус узла. `builtin` живёт отдельным флагом, а не статусом: встроенный узел
 * всегда виден и не удаляется, но публиковать/отклонять его бессмысленно.
 */
export type ProjectTypeStatus = 'private' | 'pending' | 'published' | 'rejected'

export const PROJECT_TYPE_STATUSES: readonly ProjectTypeStatus[] = ['private', 'pending', 'published', 'rejected']

export const PROJECT_TYPE_STATUS_LABELS: Readonly<Record<ProjectTypeStatus, string>> = {
  private: 'Личный',
  pending: 'На утверждении',
  published: 'Опубликован',
  rejected: 'Отклонён'
}

/** Узел дерева типов. */
export interface ProjectTypeNode {
  id: string
  parentId: string | null
  name: string
  description: string
  features: ProjectFeatureOverride
  defaults: ProjectTypeDefaults
  /** Поставляется с приложением: виден всем, не удаляется и не переименовывается. */
  builtin: boolean
  /** Автор личного узла; у встроенных — null. */
  ownerId: string | null
  status: ProjectTypeStatus
  /** Причина отказа администратора (только для `rejected`). */
  reviewNote: string
  createdBy: string
  createdAt: number
  updatedAt: number
  /**
   * Сколько проектов используют узел. Заполняется только в каталоге: владелец
   * иначе узнаёт об этом лишь по отказу при удалении.
   */
  usageCount?: number
}

/**
 * Цепочка от корня к выбранному узлу вместе с разрешёнными возможностями.
 * Отдаётся в составе проекта: участник обязан видеть имя и возможности типа даже
 * тогда, когда сам узел — личный узел владельца и в каталоге ему не показывается.
 */
export interface ProjectTypeChain {
  nodes: ProjectTypeNode[]
  features: ProjectFeatureSet
  /** «Разработка ПО / Веб-приложение». */
  label: string
}

export const MAX_PROJECT_TYPE_DEPTH = 5

/** Идентификаторы встроенных узлов: на них ссылаются миграция и фолбэки. */
export const BUILTIN_PROJECT_TYPE_IDS = {
  software: 'type-software',
  web: 'type-software-web',
  backend: 'type-software-backend',
  mobile: 'type-software-mobile',
  library: 'type-software-library',
  general: 'type-general'
} as const

export const DEFAULT_PROJECT_TYPE_ID: string = BUILTIN_PROJECT_TYPE_IDS.software

/** Описание встроенного узла до записи в БД (без служебных полей). */
export interface BuiltinProjectType {
  id: string
  parentId: string | null
  name: string
  description: string
  features: ProjectFeatureOverride
  defaults: ProjectTypeDefaults
}

const ALL_ON: ProjectFeatureOverride = { git: true, machines: true, ci: true, qa: true, releases: true, preview: true }
const ALL_OFF: ProjectFeatureOverride = { git: false, machines: false, ci: false, qa: false, releases: false, preview: false }

/**
 * Колонки «Общего проекта»: конвейер разработки там бессмыслен, поэтому остаются
 * только нейтральные статусы. Системные `done`/`cancelled`/`decision_required`
 * сохраняются — на них завязаны скрытие завершённых и ветка «требуется решение».
 */
const GENERAL_COLUMNS: { name: string; semanticType: KanbanColumnSemanticType }[] = [
  { name: 'Бэклог', semanticType: 'backlog' },
  { name: 'В работе', semanticType: 'development' },
  { name: 'Готово', semanticType: 'done' },
  { name: 'Отменено', semanticType: 'cancelled' },
  { name: 'Требуется решение', semanticType: 'decision_required' }
]

const SOFTWARE_COLUMNS: { name: string; semanticType: KanbanColumnSemanticType }[] = [
  { name: 'Бэклог', semanticType: 'backlog' },
  { name: 'Подготовка к разработке', semanticType: 'preparation' },
  { name: 'Ready for Development', semanticType: 'ready' },
  { name: 'Development', semanticType: 'development' },
  { name: 'Component QA', semanticType: 'component_qa' },
  { name: 'Создание интеграционных автотестов', semanticType: 'integration_tests' },
  { name: 'Automated QA', semanticType: 'automated_qa' },
  { name: 'Ручное QA', semanticType: 'manual_qa' },
  { name: 'Ожидает мержа', semanticType: 'awaiting_merge' },
  { name: 'Мерж', semanticType: 'merge' },
  { name: 'Готово', semanticType: 'done' },
  { name: 'Отменено', semanticType: 'cancelled' },
  { name: 'Требуется решение', semanticType: 'decision_required' }
]

const LIBRARY_COLUMNS: { name: string; semanticType: KanbanColumnSemanticType }[] = [
  { name: 'Бэклог', semanticType: 'backlog' },
  { name: 'Подготовка', semanticType: 'preparation' },
  { name: 'Готово к разработке', semanticType: 'ready' },
  { name: 'Разработка', semanticType: 'development' },
  { name: 'Автотесты', semanticType: 'automated_qa' },
  { name: 'Ожидает мержа', semanticType: 'awaiting_merge' },
  { name: 'Мерж', semanticType: 'merge' },
  { name: 'Готово', semanticType: 'done' },
  { name: 'Отменено', semanticType: 'cancelled' },
  { name: 'Требуется решение', semanticType: 'decision_required' }
]

const SOFTWARE_CI_DEFAULTS: ProjectTypeDefaults = {
  ciBaseBranch: 'main',
  ciBranchTemplate: '{task_number}',
  ciReuseStrategy: 'clean'
}

export const BUILTIN_PROJECT_TYPES: readonly BuiltinProjectType[] = [
  {
    id: BUILTIN_PROJECT_TYPE_IDS.software,
    parentId: null,
    name: 'Разработка ПО',
    description: 'Канбан с конвейером разработки, git, CI-раны, QA-этапы, релизы и машины.',
    features: ALL_ON,
    defaults: {}
  },
  {
    id: BUILTIN_PROJECT_TYPE_IDS.web,
    parentId: BUILTIN_PROJECT_TYPE_IDS.software,
    name: 'Веб-приложение',
    // Возможности целиком наследуются: отличие пока только в заготовках. Узел нужен
    // как точка опоры для соседей (бэкенд, мобильное) и личных подтипов без превью.
    description: 'Разработка ПО с веб-превью и Storybook: заготовки под фронтенд-проект.',
    features: {},
    defaults: { technologies: ['web'] }
  },
  {
    id: BUILTIN_PROJECT_TYPE_IDS.backend,
    parentId: BUILTIN_PROJECT_TYPE_IDS.software,
    name: 'Бэкенд',
    description: 'Серверное приложение: API, база данных, автоматические проверки и развёртывание.',
    features: {},
    defaults: {
      ...SOFTWARE_CI_DEFAULTS,
      columns: SOFTWARE_COLUMNS,
      technologies: ['backend', 'api', 'database'],
      skills: ['архитектура', 'API', 'базы данных'],
      defaultSkills: {
        epic: ['архитектура'],
        story: ['API', 'базы данных'],
        task: ['backend', 'тестирование']
      }
    }
  },
  {
    id: BUILTIN_PROJECT_TYPE_IDS.mobile,
    parentId: BUILTIN_PROJECT_TYPE_IDS.software,
    name: 'Мобильное приложение',
    description: 'Приложение для iOS и Android: мобильная разработка, тестирование и сборки.',
    features: {},
    defaults: {
      ...SOFTWARE_CI_DEFAULTS,
      columns: SOFTWARE_COLUMNS,
      technologies: ['mobile', 'ios', 'android'],
      skills: ['мобильная разработка', 'UI/UX', 'тестирование'],
      defaultSkills: {
        epic: ['мобильная архитектура'],
        story: ['UI/UX'],
        task: ['мобильная разработка', 'тестирование']
      }
    }
  },
  {
    id: BUILTIN_PROJECT_TYPE_IDS.library,
    parentId: BUILTIN_PROJECT_TYPE_IDS.software,
    name: 'Библиотека',
    description: 'Переиспользуемый пакет или SDK: публичный API, совместимость, тесты и публикация.',
    features: { preview: false },
    defaults: {
      ...SOFTWARE_CI_DEFAULTS,
      columns: LIBRARY_COLUMNS,
      technologies: ['library', 'sdk', 'package'],
      skills: ['проектирование API', 'совместимость', 'документация'],
      defaultSkills: {
        epic: ['проектирование API'],
        story: ['совместимость', 'документация'],
        task: ['тестирование', 'документация']
      }
    }
  },
  {
    id: BUILTIN_PROJECT_TYPE_IDS.general,
    parentId: null,
    name: 'Общий проект',
    description: 'Доска, задачи и участники без разработческой обвязки: ни git, ни CI, ни релизов.',
    features: ALL_OFF,
    defaults: { columns: GENERAL_COLUMNS }
  }
]

/** Все возможности включены: оптимистичный дефолт, пока тип ещё не загружен. */
export const ALL_PROJECT_FEATURES: ProjectFeatureSet = Object.freeze({
  git: true, machines: true, ci: true, qa: true, releases: true, preview: true
})

/** Ни одна возможность не включена — база фолда, если корень чего-то не задал. */
export const NO_PROJECT_FEATURES: ProjectFeatureSet = Object.freeze({
  git: false, machines: false, ci: false, qa: false, releases: false, preview: false
})

/** Фолд возможностей от корня к листу; неуказанное наследуется. */
export function resolveProjectTypeFeatures(chain: readonly Pick<ProjectTypeNode, 'features'>[]): ProjectFeatureSet {
  const out: Record<ProjectFeature, boolean> = { ...NO_PROJECT_FEATURES }
  for (const node of chain) {
    for (const feature of PROJECT_FEATURES) {
      const value = node.features?.[feature]
      if (typeof value === 'boolean') out[feature] = value
    }
  }
  return out
}

/**
 * Фолд заготовок от корня к листу. Значение ребёнка выигрывает целиком, включая
 * массивы: «сократить список родителя» — обычное и нужное действие.
 */
export function resolveProjectTypeDefaults(chain: readonly Pick<ProjectTypeNode, 'defaults'>[]): ProjectTypeDefaults {
  const out: ProjectTypeDefaults = {}
  for (const node of chain) {
    for (const [key, value] of Object.entries(node.defaults ?? {})) {
      if (value === undefined) continue
      ;(out as Record<string, unknown>)[key] = value
    }
  }
  return out
}

/** «Разработка ПО / Веб-приложение». */
export function projectTypeChainLabel(chain: readonly Pick<ProjectTypeNode, 'name'>[]): string {
  return chain.map((node) => node.name).join(' / ')
}

/** Узел виден пользователю: встроенный, опубликованный или его собственный. */
export function isProjectTypeVisible(node: Pick<ProjectTypeNode, 'builtin' | 'status' | 'ownerId'>, userId: string): boolean {
  return node.builtin || node.status === 'published' || node.ownerId === userId
}

/**
 * Публиковать можно только узел, у которого весь путь до корня опубликован или
 * встроен: иначе общий узел повис бы на приватном родителе, невидимом остальным.
 * `chain` — от корня к самому узлу.
 */
export function canPublishProjectType(chain: readonly Pick<ProjectTypeNode, 'builtin' | 'status'>[]): boolean {
  if (chain.length === 0) return false
  const ancestors = chain.slice(0, -1)
  return ancestors.every((node) => node.builtin || node.status === 'published')
}

/** Встроенный узел как полноценный ProjectTypeNode (для фикстур и витрины). */
function builtinAsNode(node: BuiltinProjectType): ProjectTypeNode {
  return {
    ...node,
    builtin: true,
    ownerId: null,
    status: 'published',
    reviewNote: '',
    createdBy: 'system',
    createdAt: 0,
    updatedAt: 0
  }
}

/**
 * Разрешённая цепочка встроенного типа. Нужна там, где нет сервера: фикстуры
 * тестов, Storybook, офлайн-заглушки. Это настоящие данные встроенного дерева,
 * а не выдуманный стаб, поэтому расхождения с сервером не возникает.
 */
export function builtinProjectTypeChain(id: string = DEFAULT_PROJECT_TYPE_ID): ProjectTypeChain {
  const byId = new Map(BUILTIN_PROJECT_TYPES.map((node) => [node.id, node]))
  const nodes: ProjectTypeNode[] = []
  let current = byId.get(id)
  while (current) {
    nodes.unshift(builtinAsNode(current))
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return { nodes, features: resolveProjectTypeFeatures(nodes), label: projectTypeChainLabel(nodes) }
}

/**
 * Порядок узлов в списке: встроенные впереди и в порядке объявления (основной
 * тип «Разработка ПО» должен стоять первым, а не как выйдет по алфавиту), затем
 * пользовательские по имени. Правило одно на все списки — иначе выбор при
 * создании проекта и каталог в настройках показывали бы разный порядок.
 */
export function compareProjectTypes(a: Pick<ProjectTypeNode, 'id' | 'name'>, b: Pick<ProjectTypeNode, 'id' | 'name'>): number {
  const order = (node: Pick<ProjectTypeNode, 'id'>): number => {
    const at = BUILTIN_PROJECT_TYPES.findIndex((builtin) => builtin.id === node.id)
    return at >= 0 ? at : Number.MAX_SAFE_INTEGER
  }
  return order(a) - order(b) || a.name.localeCompare(b.name, 'ru')
}

/** Родительный падеж подсистемы для фразы «в проекте нет …». */
const FEATURE_GENITIVE: Readonly<Record<ProjectFeature, string>> = {
  git: 'git-репозитория',
  machines: 'машин',
  ci: 'CI-ранов',
  qa: 'QA-этапов',
  releases: 'релизов',
  preview: 'веб-превью'
}

/**
 * Сообщение об отказе `409 feature_unavailable`. Сырой код подсистемы в тосте
 * ничего не объясняет: человек не знает, что подсистему выключил тип проекта и
 * что чинится это сменой типа, а не повтором действия.
 */
export function featureUnavailableMessage(feature: unknown): string {
  const known = parseProjectFeature(feature)
  return known
    ? `В этом проекте нет ${FEATURE_GENITIVE[known]}: их выключил тип проекта. Смените тип в настройках, если они нужны.`
    : 'Действие недоступно для текущего типа проекта. Смените тип в настройках проекта.'
}

export function parseProjectFeature(value: unknown): ProjectFeature | null {
  return typeof value === 'string' && (PROJECT_FEATURES as readonly string[]).includes(value) ? (value as ProjectFeature) : null
}

export function parseProjectTypeStatus(value: unknown): ProjectTypeStatus | null {
  return typeof value === 'string' && (PROJECT_TYPE_STATUSES as readonly string[]).includes(value)
    ? (value as ProjectTypeStatus)
    : null
}

/** Разбор переопределения возможностей из внешнего входа: чужие ключи отбрасываются. */
export function parseProjectFeatureOverride(value: unknown): ProjectFeatureOverride {
  if (!value || typeof value !== 'object') return {}
  const out: ProjectFeatureOverride = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const feature = parseProjectFeature(key)
    if (feature && typeof raw === 'boolean') out[feature] = raw
  }
  return out
}
