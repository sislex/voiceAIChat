// Типы домена «CI-раннер»: справочник команд, раны, шаги, лог, fix-loop,
// рабочие директории, предложения модели, метрики и payload'ы realtime-событий.
// Разделяются server/web (desktop CI не получает). Чистые типы + пара хелперов.

import type { QuestionSpec } from './questions'
import type { KbContextMode } from './types'
import { CLAUDE_MODELS, CODEX_MODELS } from './types'
import { estimateCostUsd } from './pricing'

/** Доступная машине выполнения задачи с основаниями доступа и живым статусом. */
export type MachineUnavailableReason =
  | 'offline'
  | 'not_shared'
  | 'not_project_member'
  | 'policy_denied'
  | 'deleted'
  | 'capacity'

export interface CiTaskMachine {
  agentId: string
  name: string
  owner?: string
  ownership?: 'mine' | 'other'
  online: boolean
  sharedWithProject?: boolean
  isMyDefault?: boolean
  canUse?: boolean
  unavailableReason?: MachineUnavailableReason | null
  load?: number
  /** Готовность именно постоянного merge-клона; CI readiness остаётся независимой. */
  mergeReadiness?: import('./merge').MergeMachineReadiness
  /** Compatibility fields for older clients. */
  personal: boolean
  project: boolean
  projectDefault: boolean
}

export interface CiTaskMachines {
  machines: CiTaskMachine[]
  selectedAgentId: string | null
  /** Сохранённый id, который больше не существует или недоступен пользователю. */
  unavailableSelection: { agentId: string; name: string | null } | null
  inheritanceSource?: 'project_default' | 'explicit'
  effectiveAgentId?: string | null
  effectiveMachineName?: string | null
}

// --- Справочник команд ---------------------------------------------------

/** Область видимости команды. */
export type CiCommandScope = 'global' | 'project'

/** Слот привязки команды вокруг работы модели. */
export type CiSlot = 'before_model' | 'after_model'
export const CI_SLOTS: CiSlot[] = ['before_model', 'after_model']

/** Управляемые этапы development-процесса в неизменяемом порядке выполнения. */
export const CI_PROCESS_STAGES = ['before_model', 'model_work', 'after_model', 'summary'] as const
export type CiProcessStage = typeof CI_PROCESS_STAGES[number]
export const CI_PROCESS_STAGE_LABELS: Record<CiProcessStage, string> = {
  before_model: 'Подготовка',
  model_work: 'Работа модели',
  after_model: 'Финальные команды',
  summary: 'Резюме модели'
}

export function normalizeCiProcessStages(value: unknown): CiProcessStage[] {
  if (!Array.isArray(value)) return [...CI_PROCESS_STAGES]
  const selected = new Set(value.filter((item): item is CiProcessStage => typeof item === 'string' && CI_PROCESS_STAGES.includes(item as CiProcessStage)))
  return CI_PROCESS_STAGES.filter((stage) => selected.has(stage))
}

/**
 * Браузерная проверка результата на стадии разработки.
 *
 * `chromium` — действия модели исполняет изолированный Chromium раннера (тот же,
 * что у Playwright Reader и этапа Automated QA), `user_panel` — живая панель
 * Web Reader пользователя. Разница принципиальная: в ране без открытой панели
 * действие в relay некому выполнить, поэтому режим выбирается заранее, а не
 * угадывается по наличию клиента.
 */
export type CiBrowserCheckMode = 'off' | 'chromium' | 'user_panel'
export const CI_BROWSER_CHECK_MODES: CiBrowserCheckMode[] = ['off', 'chromium', 'user_panel']
export const CI_BROWSER_CHECK_MODE_LABELS: Record<CiBrowserCheckMode, string> = {
  off: 'Без браузера',
  chromium: 'Изолированный Chromium',
  user_panel: 'Панель Web Reader'
}

export interface CiBrowserCheck {
  mode: CiBrowserCheckMode
  /** Порт dev-сервера на выбранной машине: страница живёт на её loopback. */
  devServerPort: number
  /** Путь первой страницы вместе с query — от корня, без схемы и хоста. */
  startPath: string
}

/** Порт по умолчанию — Vite: им поднимается клиент этого монорепо. */
export const DEFAULT_CI_BROWSER_CHECK: CiBrowserCheck = { mode: 'off', devServerPort: 5173, startPath: '/' }

/**
 * Нормализация входа: битое значение означает «проверок нет», а не отказ, —
 * иначе испорченная строка в БД лишала бы задачу возможности запустить ран.
 */
export function normalizeCiBrowserCheck(value: unknown): CiBrowserCheck {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const mode = CI_BROWSER_CHECK_MODES.includes(raw.mode as CiBrowserCheckMode)
    ? raw.mode as CiBrowserCheckMode
    : DEFAULT_CI_BROWSER_CHECK.mode
  const port = typeof raw.devServerPort === 'number' && Number.isInteger(raw.devServerPort) && raw.devServerPort >= 1 && raw.devServerPort <= 65535
    ? raw.devServerPort
    : DEFAULT_CI_BROWSER_CHECK.devServerPort
  return { mode, devServerPort: port, startPath: normalizeCiBrowserStartPath(raw.startPath) }
}

/** Путь стартовой страницы: чужой хост и схему сюда не пускаем — адрес машины собирает сервер. */
export function normalizeCiBrowserStartPath(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CI_BROWSER_CHECK.startPath
  const trimmed = value.trim()
  if (!trimmed || /[\s\\]/.test(trimmed) || trimmed.startsWith('//')) return DEFAULT_CI_BROWSER_CHECK.startPath
  const path = trimmed.startsWith('/') ? trimmed : '/' + trimmed
  if (path.length > 200 || /^\/[a-z][a-z0-9+.-]*:/i.test(path)) return DEFAULT_CI_BROWSER_CHECK.startPath
  return path
}

/**
 * Адрес стартовой страницы проверки — единственный источник для сервера и UI.
 * Хост в форме `<agentId>.machine.internal`: так его понимают и прокси превью,
 * и инструмент `open` (см. `previewMcp`).
 */
export function ciBrowserCheckUrl(check: CiBrowserCheck, agentId: string | null): string | null {
  if (check.mode === 'off' || !agentId) return null
  return `http://${agentId}.machine.internal:${check.devServerPort}${check.startPath}`
}

/**
 * Шаг, который выполняет не shell на машине, а сам сервер. В справочнике он
 * выглядит обычной командой (его можно двигать внутри слота и убирать из
 * проекта или задачи), но `script` не исполняется: раннер видит `builtin` и
 * зовёт серверный хук.
 */
export type CiBuiltinStep = 'kb_update'

/** Встроенный шаг «Актуализировать базу знаний»: id фиксирован — на него ссылаются слоты. */
export const CI_KB_UPDATE_COMMAND_ID = 'ci-builtin-kb-update'
export const CI_KB_UPDATE_COMMAND_NAME = 'Актуализировать базу знаний'

/** Именованный переиспользуемый shell-скрипт из справочника. */
export interface CiCommand {
  id: string
  scope: CiCommandScope
  /** Проект для scope='project'; null для глобальной команды. */
  projectId: string | null
  name: string
  /** Многострочный скрипт (bash). */
  script: string
  description: string
  /** Рабочая директория относительно корня рана ('' — корень). */
  workdir: string
  /** Таймаут шага в секундах (0/undefined — из глобальных настроек). */
  timeoutSec: number | null
  /** Переменные окружения команды (имя → значение). */
  env: Record<string, string>
  /** Продолжать ран при ненулевом коде выхода. */
  allowFailure: boolean
  /** После успеха этой команды рабочая директория считается освобождённой. */
  isCleanup: boolean
  /** Доступна ли команда как инструмент модели. */
  availableToModel: boolean
  /**
   * Команда-проверка (тесты/typecheck/линт). Такие шаги гоняет только воркфлоу:
   * модели они как инструмент не публикуются — иначе гейт прогоняется дважды
   * (ход модели + шаг слота), а расхождения модель чинит вслепую.
   */
  isTest: boolean
  /** Встроенный серверный шаг (script не исполняется); null/undefined — обычная команда. */
  builtin?: CiBuiltinStep | null
  /** Версия текста команды (растёт при принятии предложения/правке скрипта). */
  version: number
  createdBy: string
  createdAt: number
  updatedAt: number
  /** Мягкое удаление: время удаления или null. */
  deletedAt: number | null
}

/** Поля создания/правки команды (частичные — для PATCH). */
export interface CiCommandInput {
  scope?: CiCommandScope
  projectId?: string | null
  name?: string
  script?: string
  description?: string
  workdir?: string
  timeoutSec?: number | null
  env?: Record<string, string>
  allowFailure?: boolean
  isCleanup?: boolean
  availableToModel?: boolean
  isTest?: boolean
}

/**
 * Проверочные команды по тексту: тесты, typecheck, линт. Признак `isTest` в
 * справочнике мог не проставить тот, кто заводил команду, поэтому раннер узнаёт
 * гейт ещё и по самой команде. `npm ci` и сборка сюда не попадают: установка
 * зависимостей модели по-прежнему доступна.
 */
const VERIFICATION_RE =
  /\b(vitest|jest|affected-check)\b|\b(npm|pnpm|yarn)\s+(run\s+)?(-w\s+\S+\s+|--workspace[=\s]\S+\s+)?(test|typecheck|lint)([:\w-]*)\b/i

/** Команда — прогон гейта (по флагу справочника или по тексту команды)? */
export function isVerificationCommand(cmd: { isTest?: boolean; name?: string | null; script?: string | null }): boolean {
  return cmd.isTest === true || VERIFICATION_RE.test(cmd.name ?? '') || VERIFICATION_RE.test(cmd.script ?? '')
}

/** Привязка команды к слоту (дефолт проекта или переопределение задачи). */
export interface CiSlotCommand {
  id: string
  ownerType: 'project' | 'task'
  ownerId: string
  slot: CiSlot
  commandId: string
  /** Порядок = порядок выполнения (дробный ранг не нужен: пересобираем целиком). */
  position: number
}

/** Слот-конфиг задачи/проекта в удобном для UI виде. */
export interface CiSlotConfig {
  beforeModel: string[] // commandId[] в порядке выполнения (могут повторяться)
  afterModel: string[]
}

/** Режим шага модели: сначала план с одобрением, либо сразу разработка. */
export type CiRunMode = 'plan' | 'development'
export const CI_RUN_MODES: CiRunMode[] = ['plan', 'development']

/**
 * Глубина уточнений: сколько вопросов модель имеет право задать за ран.
 * `none` — ни одного, `few` — до 3, `medium` — до 6, `detailed` — `clarifyMax` (1..30).
 */
export type CiClarifyLevel = 'none' | 'few' | 'medium' | 'detailed'
export const CI_CLARIFY_LEVELS: CiClarifyLevel[] = ['none', 'few', 'medium', 'detailed']

/** Верхняя граница числа вопросов для «детального уточнения». */
export const CI_CLARIFY_MAX_LIMIT = 30

/**
 * Движок, модель и режим запуска шага разработки; задача наследует настройку
 * проекта (см. `resolveTaskLlmConfig`).
 */
export interface CiLlmConfig {
  /** Исполнитель LLM; null — системный исполнитель выбранного provider. */
  llmEngineId?: string | null
  provider: CiLlmProvider
  model: string
  mode: CiRunMode
  clarifyLevel: CiClarifyLevel
  /** Используется только при `clarifyLevel === 'detailed'`. */
  clarifyMax: number
}

/** Настройка LLM для самостоятельного автоматического этапа workflow. */
export interface CiStageLlmSelection {
  /** null/undefined — наследовать исполнитель. */
  llmEngineId?: string | null
  /** undefined — наследовать provider. */
  provider?: CiLlmProvider
  /** undefined — наследовать модель; пустая строка допустима для Codex. */
  model?: string
}

/** Переопределения всех автоматических этапов; отсутствующий ключ наследуется. */
export type CiWorkflowStageLlmConfig = Partial<Record<CiUsageKind, CiStageLlmSelection>>

/** Уровни цепочки выбора модели этапа. */
export interface CiStageLlmInheritance {
  taskStage?: CiStageLlmSelection | null
  projectStage?: CiStageLlmSelection | null
  projectModel?: CiStageLlmSelection | null
  systemFallback: Required<Pick<CiStageLlmSelection, 'provider' | 'model'>> & Pick<CiStageLlmSelection, 'llmEngineId'>
}

/** Зафиксированный на старте снимок исполнителя и модели этапа. */
export interface CiStageLlmSnapshot {
  llmEngineId: string | null
  provider: CiLlmProvider
  model: string
}

/**
 * Резолвит каждое поле независимо: этап задачи → этап проекта → модель проекта
 * → системный fallback. Это позволяет, например, сменить только модель этапа,
 * продолжая наследовать provider и executor.
 */
export function resolveCiStageLlm(input: CiStageLlmInheritance): CiStageLlmSnapshot {
  const levels = [input.taskStage, input.projectStage, input.projectModel, input.systemFallback]
  const first = <K extends keyof CiStageLlmSelection>(key: K): CiStageLlmSelection[K] | undefined => {
    for (const level of levels) {
      if (!level || level[key] === undefined) continue
      return level[key]
    }
    return undefined
  }
  return {
    llmEngineId: first('llmEngineId') ?? null,
    provider: first('provider') ?? input.systemFallback.provider,
    model: first('model') ?? input.systemFallback.model
  }
}

/**
 * Модель Claude по умолчанию для шага разработки CI (алиас `claude --model`).
 * Единая точка правды: на неё же опираются фолбэки сервера (пустое поле в БД,
 * старый ран без модели) и селекторы модели в UI.
 */
export const DEFAULT_CI_CLAUDE_MODEL = 'opus'

export const DEFAULT_CI_LLM_CONFIG: CiLlmConfig = {
  provider: 'claude',
  model: DEFAULT_CI_CLAUDE_MODEL,
  mode: 'development',
  clarifyLevel: 'few',
  clarifyMax: 3
}

/** Сколько вопросов модель может задать за ран при данной настройке. */
export function clarifyBudget(c: Pick<CiLlmConfig, 'clarifyLevel' | 'clarifyMax'>): number {
  switch (c.clarifyLevel) {
    case 'none':
      return 0
    case 'few':
      return 3
    case 'medium':
      return 6
    case 'detailed':
      return Math.min(CI_CLARIFY_MAX_LIMIT, Math.max(1, Math.round(c.clarifyMax) || 1))
    default:
      return 0
  }
}

// --- Модель по стадии рана -------------------------------------------------

/**
 * Модель на стадию рана. Ключ — тот же `CiUsageKind`, которым помечается строка
 * расхода, поэтому настройка и отчёт говорят об одном и том же: чем стадию
 * назначили считать, тем в отчёте она и посчитана. Пустая строка — «модель
 * рана».
 */
export type CiStageModels = Partial<Record<CiUsageKind, string>>

/**
 * Дефолт: вспомогательные стадии — на дешёвой модели, разработка и fix-loop — на
 * модели рана. Сверка дифа с текстом статей и пересказ шагов — работа не того
 * класса, что разработка: по факту CHAT-70 актуализация базы знаний забирала 14%
 * цены рана ($2.75) и 7 минут, резюме — ещё $0.11. Экономить на самой разработке
 * нельзя: там она означает худший код, а он дороже сэкономленного.
 */
export const DEFAULT_CI_STAGE_MODELS: CiStageModels = {
  planning: '',
  model_work: '',
  fix: '',
  qa_analysis: '',
  data_preparation: '',
  code_review: '',
  kb_update: 'sonnet',
  release_analysis: '',
  summary: 'haiku'
}

/**
 * Известен ли алиас модели движку. Реестр исполнителей моделей не перечисляет,
 * поэтому единственная доступная проверка — знает ли такой алиас сам CLI: у
 * claude это `default`/`opus`/`fable`/`sonnet`/`haiku` (с необязательным
 * префиксом `claude-` и суффиксом окна `[1m]`), у codex — список его моделей.
 * Неизвестная модель стадии не должна ронять ран — вызов откатится на модель
 * рана (`resolveCiStageModel`).
 */
export function ciModelKnown(provider: CiLlmProvider, model: string): boolean {
  const raw = model.trim()
  if (!raw) return false
  if (provider === 'codex') return CODEX_MODELS.some((m) => m.id === raw)
  const alias = raw.replace(/^claude-/, '').replace(/\[1m\]$/, '')
  return CLAUDE_MODELS.some((m) => m.id.replace(/\[1m\]$/, '') === alias)
}

/**
 * Какой моделью считать стадию. Пусто, «то же, что у рана» или модель, которой у
 * движка рана нет (claude-алиас в codex-ране, опечатка в настройке) — берётся
 * модель рана: стадия обязана выполниться, пусть и дороже.
 */
export function resolveCiStageModel(
  stage: CiUsageKind,
  stageModels: Partial<CiStageModels> | null | undefined,
  run: { llmProvider: CiLlmProvider; llmModel: string }
): string {
  // У codex пустая модель штатна (он берёт её из своего config.toml), у claude
  // пустое поле означает дефолт CI — так же, как при старте рана.
  const runModel = run.llmProvider === 'codex' ? run.llmModel : run.llmModel || DEFAULT_CI_CLAUDE_MODEL
  const wanted = (stageModels?.[stage] ?? '').trim()
  if (!wanted || wanted === runModel) return runModel
  return ciModelKnown(run.llmProvider, wanted) ? wanted : runModel
}

/** Настройка стадий из БД/тела запроса: чужие ключи прочь, значения — строки. */
export function normCiStageModels(raw: unknown): CiStageModels {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: CiStageModels = { ...DEFAULT_CI_STAGE_MODELS }
  for (const kind of CI_USAGE_KINDS) {
    if (!(kind in src)) continue
    out[kind] = typeof src[kind] === 'string' ? (src[kind] as string).trim() : ''
  }
  return out
}

// --- Сжатие контекста хода: лимиты ответов инструментов -------------------

/**
 * Цена хода — произведение размера контекста на число запросов: каждый вызов
 * инструмента уходит новым запросом ко ВСЕМУ накопленному контексту, поэтому
 * один толстый ответ (вывод `npm ci`, лог тестов) оплачивается столько раз,
 * сколько запросов осталось до конца хода. Замер CHAT-70: 24.1M токенов чтения
 * кэша на 186 запросов — около 130k контекста в среднем на запрос и 75% цены
 * рана. Отсюда капы на ответы инструментов моста: они режут МНОЖИТЕЛЬ «размер
 * контекста», а не число вызовов.
 *
 * Лимиты — настройки (`ci_settings`), а не константы кода: подобрать их можно
 * только замером, и менять их приходится без пересборки.
 */
export interface ToolOutputLimits {
  /** Кап на ответ `bash` (символы): голова + хвост с пометкой об обрезке. */
  bashChars: number
  /** Кап на ответ `read` (символы) — окно строк режется по нему. */
  readChars: number
  /** Максимум строк в одном окне `read`. */
  readLines: number
  /** Максимум совпадений в ответе `grep`. */
  grepMatches: number
  /** Кап на ответ `grep` (символы). */
  grepChars: number
}

/**
 * Дефолты лимитов; они же — значения по умолчанию колонок `ci_settings`.
 *
 * Подобраны замером на ранах CHAT-68/70 (симуляция по ленте: каждый ответ
 * перечитывается на всех последующих запросах хода). Дальше 8k у `bash` эффект
 * почти не растёт — 6k дают лишний процент, — а вот резать окно `read` ниже
 * ~20k вредно: модель добирает файл повторными вызовами, и вместо экономии
 * растёт ЧИСЛО запросов, второй множитель цены. Значения — настройки, потому
 * что этот баланс проверяется только следующим замером.
 */
export const DEFAULT_TOOL_OUTPUT_SETTINGS = {
  bashOutputLimitChars: 8_000,
  readOutputLimitChars: 24_000,
  readWindowMaxLines: 600,
  grepMatchLimit: 100,
  grepOutputLimitChars: 8_000
}

/**
 * Границы значений. Ран не имеет права упасть из-за настройки: NaN, ноль и
 * минус превращаются в дефолт, слишком маленькое — в минимум (иначе модель не
 * увидит ни причины падения, ни контекста), слишком большое — в максимум.
 */
const TOOL_OUTPUT_BOUNDS: Record<keyof ToolOutputLimits, [number, number]> = {
  bashChars: [1_000, 400_000],
  readChars: [1_000, 400_000],
  readLines: [40, 2_000],
  grepMatches: [5, 1_000],
  grepChars: [1_000, 200_000]
}

function clampLimit(value: unknown, fallback: number, [min, max]: [number, number]): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Лимиты моста из настроек CI (частичные и битые значения → дефолты). */
export function ciToolOutputLimits(settings?: Partial<CiGlobalSettings> | null): ToolOutputLimits {
  const d = DEFAULT_TOOL_OUTPUT_SETTINGS
  const s = settings ?? {}
  return {
    bashChars: clampLimit(s.bashOutputLimitChars, d.bashOutputLimitChars, TOOL_OUTPUT_BOUNDS.bashChars),
    readChars: clampLimit(s.readOutputLimitChars, d.readOutputLimitChars, TOOL_OUTPUT_BOUNDS.readChars),
    readLines: clampLimit(s.readWindowMaxLines, d.readWindowMaxLines, TOOL_OUTPUT_BOUNDS.readLines),
    grepMatches: clampLimit(s.grepMatchLimit, d.grepMatchLimit, TOOL_OUTPUT_BOUNDS.grepMatches),
    grepChars: clampLimit(s.grepOutputLimitChars, d.grepOutputLimitChars, TOOL_OUTPUT_BOUNDS.grepChars)
  }
}

/** Лимиты по умолчанию в виде, готовом для моста (без настроек — дефолты). */
export const DEFAULT_TOOL_OUTPUT_LIMITS: ToolOutputLimits = ciToolOutputLimits()

/**
 * Метка обрезанного ответа. Обязана быть в тексте, который увидела модель:
 * молча урезанный вывод она читает как полный и делает вывод по обрубку.
 * По этой же метке обрезка видна в ленте рана и считается в метрике.
 */
export const TOOL_OUTPUT_TRIM_MARK = '⟦обрезано'

/** Ответ несёт метку обрезки (лента, метрика, тесты). */
export function isTrimmedToolOutput(text: string): boolean {
  return text.includes(TOOL_OUTPUT_TRIM_MARK)
}

/**
 * Сколько символов было до обрезки — по самой метке. Сервер видит ответ уже
 * готовым (мост живёт в другом запросе), и «сколько бы ушло в контекст без
 * лимита» больше взять негде. `null` — метки нет или в ней нет числа (окно
 * `read` и `grep` режутся по строкам, там исходного объёма не считают).
 */
export function trimmedToolOutputOriginalChars(text: string): number | null {
  const m = text.match(/⟦обрезано: из (\d+) символов/)
  return m ? Number(m[1]) : null
}

/**
 * Доля лимита под голову вывода. Хвост важнее головы: причина падения (упавший
 * тест, стек, `npm ERR!`) внизу, а сверху — шапка и прогресс. Fix-loop смотрит
 * именно в хвост, поэтому обрезка режет середину.
 */
const TRIM_HEAD_SHARE = 0.25

export interface TrimmedToolOutput {
  /** Текст для модели: голова, метка, хвост (или исходник, если влез). */
  text: string
  /** Длина отданного текста. */
  chars: number
  /** Длина исходного вывода — сколько бы ушло в контекст без обрезки. */
  originalChars: number
  truncated: boolean
}

/** Обрезать по границе строки, чтобы модель не читала полстроки как целую. */
function cutHead(text: string, budget: number): string {
  const raw = text.slice(0, budget)
  const nl = raw.lastIndexOf('\n')
  return nl > budget / 2 ? raw.slice(0, nl) : raw
}

function cutTail(text: string, budget: number): string {
  const raw = text.slice(text.length - budget)
  const nl = raw.indexOf('\n')
  return nl >= 0 && nl < budget / 2 ? raw.slice(nl + 1) : raw
}

/**
 * Сжать ответ инструмента до лимита: голова, явная метка с числами, хвост.
 * Не бросает ни на каких входных данных: битый лимит уже приведён
 * `ciToolOutputLimits`, а пустой текст возвращается как есть.
 *
 * `hint` — чем дочитать пропущенное (у каждого инструмента своё): метка обязана
 * не только сообщить об обрезке, но и дать модели способ добрать данные
 * точечно, иначе она повторит ту же команду и заплатит второй раз.
 */
export function trimToolOutput(text: string, limitChars: number, hint?: string): TrimmedToolOutput {
  const originalChars = text.length
  if (originalChars <= limitChars) return { text, chars: originalChars, originalChars, truncated: false }
  const headBudget = Math.max(1, Math.floor(limitChars * TRIM_HEAD_SHARE))
  const head = cutHead(text, headBudget)
  const tail = cutTail(text, Math.max(1, limitChars - head.length))
  const cut = originalChars - head.length - tail.length
  const mark =
    `${TOOL_OUTPUT_TRIM_MARK}: из ${originalChars} символов показаны первые ${head.length} и последние ` +
    `${tail.length}, вырезано ${cut} в середине — вывод не влез в лимит контекста хода (${limitChars}). ` +
    `Данные неполные${hint ? `; ${hint}` : ''}.⟧`
  const out = `${head}\n\n${mark}\n\n${tail}`
  return { text: out, chars: out.length, originalChars, truncated: true }
}

// --- Глобальные настройки CI ---------------------------------------------

export interface CiGlobalSettings {
  /** Лимит попыток исправления на один упавший шаг. */
  maxFixAttempts: number
  /** Страховка fix-loop по времени, мс (0 — без лимита). */
  fixTimeLimitMs: number
  /** Страховка fix-loop по токенам (0 — без лимита). */
  fixTokenLimit: number
  /** Таймаут шага по умолчанию, сек. */
  defaultStepTimeoutSec: number
  /** Сколько последних ранов учитывать в метриках по командам. */
  metricsWindow: number
  /** Лимит одновременных ранов на сервер. */
  maxConcurrentRuns: number
  /** Лимит вызовов команд моделью на один ран. */
  maxModelCommandCalls: number
  /** Сколько ждать ответа пользователя на вопрос/одобрение, мс (0 — без лимита). */
  interactionWaitMs: number
  /** Модель на стадию рана; пустое значение стадии — модель рана. */
  stageModels: CiStageModels
  /** Кап на ответ инструмента `bash` (символы) — см. `ciToolOutputLimits`. */
  bashOutputLimitChars: number
  /** Кап на ответ инструмента `read` (символы). */
  readOutputLimitChars: number
  /** Максимум строк в одном окне `read`. */
  readWindowMaxLines: number
  /** Максимум совпадений в ответе `grep`. */
  grepMatchLimit: number
  /** Кап на ответ инструмента `grep` (символы). */
  grepOutputLimitChars: number
}

export const DEFAULT_CI_GLOBAL_SETTINGS: CiGlobalSettings = {
  maxFixAttempts: 10,
  fixTimeLimitMs: 30 * 60 * 1000,
  fixTokenLimit: 600_000,
  defaultStepTimeoutSec: 1_800,
  metricsWindow: 20,
  maxConcurrentRuns: 2,
  maxModelCommandCalls: 20,
  interactionWaitMs: 30 * 60 * 1000,
  stageModels: DEFAULT_CI_STAGE_MODELS,
  ...DEFAULT_TOOL_OUTPUT_SETTINGS
}

/** Стратегия повторного запуска при существующей рабочей директории. */
export type CiReuseStrategy = 'reuse' | 'clean' | 'fail'
export const CI_REUSE_STRATEGIES: CiReuseStrategy[] = ['reuse', 'clean', 'fail']

/** CI-поля настроек проекта. */
export interface CiProjectSettings {
  baseBranch: string
  /** Шаблон ветки, по умолчанию `{task_number}` (`CHAT-172`); legacy `{slug}` поддерживается. */
  branchTemplate: string
  reuseStrategy: CiReuseStrategy
  /** Ссылка на секрет для авторизации выполнения (или ''). */
  execAuthRef: string
}

// --- Ран и шаги ----------------------------------------------------------

/** Общий статус рана и шага. */
export type CiLlmProvider = 'claude' | 'codex'

export type CiStatus = 'queued' | 'running' | 'awaiting_input' | 'success' | 'failed' | 'interrupted' | 'cancelled' | 'timeout' | 'skipped'
export const CI_STATUSES: CiStatus[] = ['queued', 'running', 'awaiting_input', 'success', 'failed', 'interrupted', 'cancelled', 'timeout', 'skipped']

/** Результат попытки убрать ран из очереди. Сервер возвращает фактическое состояние,
 * чтобы клиент не сообщил об успехе, если ран успел начаться. */
export type CiQueueRemovalResult =
  | { status: 'removed'; run: CiRun }
  | { status: 'running'; run: CiRun }
  | { status: 'not_queued'; run: CiRun }
  | { status: 'not_found' }

/** Терминальные статусы рана. */
export function isTerminalCiStatus(s: CiStatus): boolean {
  return s === 'success' || s === 'failed' || s === 'interrupted' || s === 'cancelled' || s === 'timeout'
}

/**
 * Ран ещё идёт (в очереди, работает или ждёт ответа): повторный запуск задачи
 * недоступен, из действий остаётся только лента рана.
 */
export function isActiveCiStatus(s: CiStatus): boolean {
  return s === 'queued' || s === 'running' || s === 'awaiting_input'
}

/**
 * Доступен ли запуск рана задачи прямо сейчас (кнопка «Выполнить» на карточке и
 * в модалке). Завершённый ран запуску не мешает — ни успешный, ни упавший, ни
 * отменённый: «Выполнить» стартует новый полный ран, а не продолжает прошлый
 * (для продолжения есть «Повторить с упавшего шага» в ленте). Кнопки нет только
 * пока ран активен: в очереди, работает или стоит на паузе (`awaiting_input`).
 */
export function canStartCiRun(summary: { status: CiStatus } | null | undefined): boolean {
  return summary == null || !isActiveCiStatus(summary.status)
}

/**
 * Доступно ли действие «Параллельно». В отличие от создания нового рана оно
 * умеет продвинуть queued-run, но running и awaiting_input остаются защищены.
 */
export function canStartParallelCiRun(summary: { status: CiStatus } | null | undefined): boolean {
  return summary?.status === 'queued' || canStartCiRun(summary)
}

// --- Способ запуска и распределение по машинам -----------------------------

/**
 * Как ран попадает в работу: `queue` — общая FIFO-очередь сервера по
 * `maxConcurrentRuns`; `parallel` — сразу в работу, мимо очереди и лимита.
 * Параллельный запуск не персистится: повтор упавшего рана идёт через очередь.
 */
export type CiRunLaunch = 'queue' | 'parallel'

/**
 * Выбор машины для параллельного запуска. Правила по порядку: машина проекта
 * по умолчанию, если на ней нет активных ранов; иначе любая машина проекта без
 * активных ранов; иначе машина с минимальным их числом. `activeCounts` обязан
 * учитывать раны с пустым `agentId` за машиной по умолчанию их проекта — иначе
 * старые раны делают её «свободной» на бумаге, и всё валится на одну машину.
 * При равной загрузке предпочитается машина по умолчанию, затем порядок списка.
 */
export function pickCiRunAgent(
  machineIds: string[],
  defaultAgentId: string | null,
  activeCounts: Record<string, number>
): string | null {
  const count = (id: string): number => activeCounts[id] ?? 0
  if (defaultAgentId && machineIds.includes(defaultAgentId) && count(defaultAgentId) === 0) return defaultAgentId
  const free = machineIds.find((id) => count(id) === 0)
  if (free) return free
  let best: string | null = null
  for (const id of machineIds) {
    if (best === null || count(id) < count(best) || (count(id) === count(best) && id === defaultAgentId)) best = id
  }
  return best
}

/**
 * Как подсветить карточку задачи по последнему рану:
 * `running` — медленно «дышит» голубым, `fixing` — модель разбирается с ошибкой
 * (медленно мигает красным), `awaiting` — ждёт ответа пользователя (часто мигает
 * жёлтым), `failed` — свалился окончательно (часто мигает красным), `done` —
 * разработка закончена, ждёт пересборки прода (статичная зелёная рамка).
 * `null` — подсветки нет (рана не было, отменён или пропущен).
 */
export type CiCardPulse = 'running' | 'fixing' | 'awaiting' | 'failed' | 'done'

/**
 * Состояние рана, актуальное для поверхностей задачи. Ручное завершение задачи
 * сильнее старого терминального падения: ошибка остаётся в истории рана, но не
 * должна продолжать красить уже закрытую карточку и её чат. Активный ран не
 * скрываем — перенос во время работы не должен маскировать живой процесс.
 */
export function ciSummaryForTask<T extends { status: CiStatus }>(
  summary: T | null | undefined,
  taskDone: boolean
): T | null {
  if (!summary) return null
  return taskDone && (summary.status === 'failed' || summary.status === 'interrupted' || summary.status === 'timeout') ? null : summary
}

export function ciCardPulse(
  summary: { status: CiStatus; slotProgress: Pick<CiSlotProgress, 'fixing'> } | null | undefined
): CiCardPulse | null {
  if (!summary) return null
  switch (summary.status) {
    case 'awaiting_input':
      return 'awaiting'
    case 'queued':
    case 'running':
      return summary.slotProgress.fixing ? 'fixing' : 'running'
    case 'failed':
    case 'interrupted':
    case 'timeout':
      return 'failed'
    case 'success':
      return 'done'
    default:
      return null
  }
}

/** Вид шага ленты рана. */
export type CiStepKind = 'command' | 'model_work' | 'model_command' | 'model_summary'

/** Кто инициировал шаг. */
export type CiInitiatedBy = 'user' | 'system' | 'model'

/** Самостоятельное наблюдаемое выполнение автоматического этапа workflow. */
export interface CiStageRun {
  id: string
  runId: string
  taskId: string
  stage: CiUsageKind
  status: CiStatus
  /** Неизменяемый снимок выбора на момент запуска этапа. */
  llm: CiStageLlmSnapshot
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
  /** Агрегированный расход этапа; подробные строки остаются в ci_run_usage. */
  usage: CiUsageTotals
  /** Машиночитаемый/текстовый итог этапа. */
  outcome: string | null
}

/** Один запуск воркфлоу для конкретной задачи. */
export interface CiRun {
  id: string
  projectId: string
  taskId: string
  /** Машина выполнения (agentId). */
  agentId: string | null
  /** Immutable machine ownership/selection snapshot. */
  agentOwnerId?: string | null
  agentOwnerName?: string
  agentSelectionSource?: 'explicit' | 'explicit_bypass' | 'task_pinned' | 'project_default' | 'user_project_default' | 'fallback' | 'unknown'
  status: CiStatus
  /** Человекочитаемая причина терминального сбоя/отмены; обязательна для failed. */
  error: string | null
  workspaceId: string | null
  /** Логин запустившего. */
  triggeredBy: string
  /** Колонка задачи до рана — возможная цель условного отката. */
  prevColumnId: string | null
  /** Колонка, занятая раннером; rollback допустим, только пока задача остаётся в ней. */
  runColumnId?: string | null
  /** Снимок этапа задачи в момент терминальной финализации. */
  terminalColumnId?: string | null
  /** Снимок выбранного исполнителя; null — legacy/default для провайдера. */
  llmEngineId?: string | null
  /** Провайдер и модель шага разработки; можно сменить при повторе упавшего model_work. */
  llmProvider: CiLlmProvider
  llmModel: string
  /** Снимок режима и глубины уточнений на момент запуска (повтор их сохраняет). */
  mode: CiRunMode
  clarifyLevel: CiClarifyLevel
  clarifyMax: number
  /** Связанный чат задачи, куда дублируются вопросы модели. */
  conversationId: string | null
  /** Сессия CLI разработки/fix-loop; хранится в БД для продолжения после рестарта. */
  modelSessionId?: string | null
  /** Последняя диагностика fix-loop; позволяет продолжить со свежего падения после рестарта. */
  fixContext?: CiFixDiagnosticContext | null
  /**
   * Снимок режима базы знаний на момент старта (берётся из настройки проекта
   * `ciKbContextMode`, а НЕ из связанного чата): смена настройки не меняет уже
   * идущий ран, а ленте и отчётам видно, в каком режиме он работал.
   */
  kbContextMode: KbContextMode
  /** Прогресс по слотам: {done,total} для шкалы «1/4». */
  slotProgress: CiSlotProgress
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
  createdAt: number
}

/** Прогресс воркфлоу (вызовы команд моделью НЕ учитываются). */
export interface CiSlotProgress {
  done: number
  total: number
  /** Читаемая фаза для шкалы карточки. */
  phase: string
  /** Модель прямо сейчас разбирается с упавшим шагом (fix-loop). */
  fixing?: boolean
}

/** Элемент ленты рана. */
export interface CiRunStep {
  id: string
  runId: string
  slot: CiSlot | null
  position: number
  kind: CiStepKind
  /** Вложенность (вызов команды моделью → parent = model_work). */
  parentStepId: string | null
  initiatedBy: CiInitiatedBy
  /** Ссылка на команду справочника (для command/model_command). */
  commandId: string | null
  /** Снапшот текста команды на момент рана (версионирование). */
  commandSnapshot: string | null
  /** Отображаемое имя шага. */
  title: string
  workdir: string | null
  status: CiStatus
  exitCode: number | null
  /** Номер попытки (fix-loop перезапускает упавший шаг). */
  attempt: number
  /** Шаг был доведён до успеха моделью в fix-loop. */
  fixedByModel: boolean
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
}

/** Одна строка потокового лога (для реплея после reconnect). */
export interface CiLogLine {
  runId: string
  stepId: string
  /** Монотонный курсор в пределах рана. */
  seq: number
  stream: 'stdout' | 'stderr' | 'system'
  chunk: string
  at: number
}

// --- Интеракция: пауза рана в ожидании пользователя -----------------------

/** Что именно ждёт ран: уточняющие вопросы модели или одобрение плана. */
export type CiInteractionKind = 'clarify' | 'plan_approval'

export type CiInteractionStatus = 'pending' | 'answered' | 'cancelled'

/** Решение пользователя по плану. */
export type CiPlanDecision = 'approved' | 'rework'

/**
 * Одна пауза рана. Пока `status === 'pending'`, ран стоит в `awaiting_input`.
 * Ответить можно из ленты рана или из связанного чата — засчитывается первый.
 */
export interface CiInteraction {
  id: string
  runId: string
  /** Шаг ленты, внутри которого висит пауза (обычно `model_work`). */
  stepId: string
  /** Монотонный номер интеракции в пределах рана. */
  seq: number
  kind: CiInteractionKind
  /** Для `clarify` — вопросы модели; для `plan_approval` пусто. */
  questions: QuestionSpec[]
  /** Для `plan_approval` — текст плана. */
  planText: string | null
  /** Ответ пользователя (для плана — комментарий к доработке). */
  answerText: string | null
  decision: CiPlanDecision | null
  status: CiInteractionStatus
  /** Чат, куда продублирован вопрос, и id сообщения в нём. */
  conversationId: string | null
  messageId: string | null
  createdAt: number
  answeredAt: number | null
  answeredBy: string | null
}

/** Тело ответа на интеракцию (REST). */
export interface CiInteractionAnswer {
  text?: string
  decision?: CiPlanDecision
}

/** Фактический LLM-снимок, который UI показывает для текущего этапа рана. */
export interface CiExecutionLlmSnapshot {
  /** `stage` — сохранённый ci_stage_run; `run` — базовый снимок до старта стадии. */
  source: 'stage' | 'run'
  /** null означает, что стадийный запуск ещё не создан. */
  stage: CiUsageKind | null
  llmEngineId: string | null
  provider: CiLlmProvider | null
  model: string | null
  /** Отдельный базовый снимок ci_run — никогда не смешивается со стадийной парой. */
  base: { llmEngineId: string | null; provider: CiLlmProvider | null; model: string | null }
}

/** Полный снимок рана с шагами (ответ GET деталь рана). */
export interface CiRunDetail {
  run: CiRun
  /** Фактический снимок текущей/последней стадии, вычисленный только из истории рана. */
  executionLlm?: CiExecutionLlmSnapshot
  /** Отдельные выполнения автоматических этапов; отсутствует у legacy API/ранов. */
  stageRuns?: CiStageRun[]
  steps: CiRunStep[]
  fixAttempts: CiFixAttempt[]
  /** Паузы рана — без них после reload pending-вопрос не восстановить. */
  interactions: CiInteraction[]
}

/** Состояние наблюдаемого автоматического процесса. Сервер — единственный
 * источник завершённых шагов и процента; клиенту разрешено тикать только elapsed. */
export type AutomationProgressStatus = 'queued' | 'running' | 'waiting' | 'success' | 'failed' | 'cancelled'

export interface AutomationProgressStep {
  id: string
  title: string
  status: AutomationProgressStatus | 'pending' | 'skipped'
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
}

export interface AutomationProgress {
  runId: string
  /** Монотонная версия снимка внутри runId. */
  version: number
  stage: string
  status: AutomationProgressStatus
  startedAt: number | null
  finishedAt: number | null
  elapsedMs: number
  /** null означает неизвестный заранее объём и indeterminate progressbar. */
  percent: number | null
  completedSteps: number
  totalSteps: number | null
  currentStep: string | null
  etaMs: number | null
  etaRangeMs: [number, number] | null
  etaUnavailableReason: string | null
  logUrl: string
  steps: AutomationProgressStep[]
}

function automationStatus(status: CiStatus): AutomationProgressStatus | 'pending' | 'skipped' {
  if (status === 'awaiting_input') return 'waiting'
  if (status === 'timeout' || status === 'interrupted') return 'failed'
  return status
}

/**
 * Строит серверный снимок CI-прогресса из фактически сохранённых шагов.
 * model_work намеренно indeterminate, пока он активен: число его внутренних
 * операций заранее неизвестно. ETA появляется лишь после фактических измерений.
 */
export function buildCiAutomationProgress(
  run: CiRun,
  steps: CiRunStep[],
  historicalStepDurations: Record<string, number[]> = {},
  now = Date.now()
): AutomationProgress {
  const ordered = [...steps].filter((step) => step.parentStepId == null).sort((a, b) => a.position - b.position)
  const current = ordered.find((step) => step.status === 'running' || step.status === 'awaiting_input') ?? null
  const completed = ordered.filter((step) => step.status === 'success' || step.status === 'skipped')
  const terminal = isTerminalCiStatus(run.status)
  const unknownWork = current?.kind === 'model_work'
  const knownTotal = Math.max(run.slotProgress.total, ordered.length)
  const percent = run.status === 'success'
    ? 100
    : unknownWork
      ? null
      : knownTotal > 0 ? Math.min(99, Math.round((completed.length / knownTotal) * 100)) : null
  const measured = completed.map((step) => step.durationMs).filter((value): value is number => value != null && value > 0)
  const historical = ordered.flatMap((step) => historicalStepDurations[step.title] ?? []).filter((value) => value > 0)
  const samples = measured.length ? measured : historical
  const remaining = Math.max(0, knownTotal - completed.length)
  const average = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null
  const etaMs = terminal || unknownWork || average == null ? null : Math.round(average * remaining)
  const elapsedMs = run.startedAt == null ? 0 : Math.max(0, (run.finishedAt ?? now) - run.startedAt)
  const stateRank = (status: CiStatus): number =>
    status === 'success' || status === 'failed' || status === 'interrupted' || status === 'cancelled' || status === 'timeout' || status === 'skipped'
      ? 4 : status === 'awaiting_input' ? 3 : status === 'running' ? 2 : status === 'queued' ? 1 : 0
  const version = Math.max(
    run.createdAt,
    run.startedAt ?? 0,
    run.finishedAt ?? 0,
    ...ordered.map((step) => step.finishedAt ?? step.startedAt ?? 0)
  ) * 1000 + Math.min(990, ordered.reduce((sum, step) => sum + stateRank(step.status), stateRank(run.status)))

  return {
    runId: run.id,
    version,
    stage: run.status === 'queued' ? 'Очередь' : run.status === 'awaiting_input' ? 'Ожидание пользователя' : current?.title ?? run.slotProgress.phase,
    status: automationStatus(run.status) as AutomationProgressStatus,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    elapsedMs,
    percent,
    completedSteps: completed.length,
    totalSteps: unknownWork ? null : knownTotal || null,
    currentStep: current?.title ?? (terminal ? run.slotProgress.phase : null),
    etaMs,
    etaRangeMs: etaMs == null ? null : [Math.round(etaMs * 0.75), Math.round(etaMs * 1.25)],
    etaUnavailableReason: terminal ? null : unknownWork ? 'Объём текущей операции заранее неизвестен' : average == null ? 'Пока недостаточно данных для оценки' : null,
    logUrl: `/api/ci/runs/${encodeURIComponent(run.id)}/log`,
    steps: ordered.map((step) => ({
      id: step.id,
      title: step.title,
      status: automationStatus(step.status),
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      durationMs: step.durationMs
    }))
  }
}

/** Краткая сводка рана по задаче — для доски/карточки. */
export interface CiRunSummary {
  id: string
  taskId: string
  status: CiStatus
  /** Короткая причина терминального результата для карточки задачи. */
  error: string | null
  slotProgress: CiSlotProgress
  durationMs: number | null
  /** Активна ли работа модели прямо сейчас. */
  modelActive: boolean
  /** Ран стоит и ждёт ответа пользователя. */
  awaitingInput: boolean
  /** Серверный снимок фактического прогресса; отсутствует у legacy payload. */
  progress?: AutomationProgress
  /** Фактический LLM активной/последней стадии; базовый снимок до её старта. */
  executionLlm?: CiExecutionLlmSnapshot
  /** Этап задачи, на котором был зафиксирован терминальный результат. */
  terminalColumnId?: string | null
  /** Более новая отменённая/пропущенная попытка, не заменяющая основной результат. */
  latestAttempt?: CiRunSummary | null
}

// --- fix-loop ------------------------------------------------------------

/** Структурированная ошибка теста, извлечённая из вывода проверочного шага. */
export interface CiTestFailure {
  packageName: string | null
  file: string | null
  testName: string | null
  command: string | null
  message: string
}

/** Сохраняемый контекст последнего падения fix-loop. */
export interface CiFixDiagnosticContext {
  stepId: string
  logTail: string
  failures: CiTestFailure[]
  updatedAt: number
}

/** Точечная проверка, которую модель запускала внутри попытки исправления. */
export interface CiTargetedTestRun {
  command: string
  exitCode: number | null
  timedOut: boolean
  output: string
}

/** Одна итерация цикла исправления упавшего шага моделью. */
export interface CiFixAttempt {
  id: string
  runStepId: string
  attemptNo: number
  /** Что именно сломалось (одна-две фразы). */
  diagnosis: string
  /** Что модель сделала. */
  action: string
  /** Итог итерации. */
  result: 'fixed' | 'retrying' | 'gave_up'
  /** Дифф изменений в рабочей директории. */
  diff: string | null
  /** Файлы, изменённые моделью в этой попытке. */
  changedFiles: string[]
  /** Точечные тесты, запущенные моделью до полного повтора. */
  targetedTests: CiTargetedTestRun[]
  /** Итог полного повторного запуска упавшей команды. */
  fullRerun: { stepId: string; exitCode: number | null; timedOut: boolean } | null
  /** Структурированные ошибки, на которых основывалась попытка. */
  failures: CiTestFailure[]
  durationMs: number | null
  tokensUsed: number | null
  createdAt: number
}

// --- Рабочие директории --------------------------------------------------

export interface CiWorkspace {
  id: string
  projectId: string
  taskId: string
  agentId: string | null
  path: string
  /** Фактическая ветка и проверенный SHA результата разработки. */
  branch: string | null
  commitSha: string | null
  pushed: boolean
  state: 'active' | 'released'
  /** Занимаемый объём в байтах (для отчёта по месту; null — не измерялся). */
  sizeBytes: number | null
  createdAt: number
  /** Шаг с is_cleanup, освободивший директорию, или null. */
  releasedByStepId: string | null
}

/** Строка отчёта по занятому месту. */
export interface CiWorkspaceReportItem extends CiWorkspace {
  taskTitle: string | null
  /** Осиротевшая: активна, но задача закрыта/удалена и cleanup не выполнялся. */
  orphaned: boolean
}

// --- Предложения модели по правке команды --------------------------------

export type CiSuggestionStatus = 'new' | 'accepted' | 'rejected'

export type ImprovementStatus = 'new' | 'accepted' | 'rejected' | 'implemented'
export type ImprovementSource = 'development' | 'preparation' | 'component_qa' | 'integration_tests' | 'automated_qa' | 'merge' | 'system'
export type ImprovementAction = 'create_chatai_task' | 'reconfigure_commands' | 'support_ticket'

export interface TaskImprovement {
  id: string
  taskId: string
  projectId: string
  runId: string | null
  stepId: string | null
  source: ImprovementSource
  status: ImprovementStatus
  title: string
  description: string
  acceptanceCriteria: string
  createdTaskId: string | null
  fingerprint: string
  evidence: string[]
  /** Файлы репозитория, упомянутые в логе шага: подсказка, куда смотреть при реализации. */
  files: string[]
  occurrences: number
  suggestedAction: ImprovementAction
  isNew: boolean
  createdAt: number
  updatedAt: number
}

/** Предложение в проектной очереди «Улучшения»: вместе с исходной задачей. */
export interface ProjectImprovement extends TaskImprovement {
  taskTitle: string
  taskSeq: number
  taskColumnId: string
}

/**
 * Поля необязательны: без них задача берёт название, описание и критерии из
 * самого предложения, а колонку — единственную с семантикой `backlog` (TODO).
 */
export interface CreateTaskFromImprovementInput {
  columnId?: string
  title?: string
  description?: string
  acceptanceCriteria?: string
  /** Сразу перевести созданную задачу в «Подготовку к выполнению» и запустить её. */
  startPreparation?: boolean
}

export interface CreateTaskFromImprovementResult {
  task: import('./projects.js').Task
  improvement: TaskImprovement
  created: boolean
  /** Подготовка запущена (только при `startPreparation`). */
  preparationStarted: boolean
  /** Почему подготовку не удалось запустить; задача при этом создана. */
  preparationError: string | null
}

const IMPROVEMENT_FILE_PATTERN = /(?:^|[\s"'`(\[<])((?:apps|packages|src|docs|scripts|tests?|lib|config|public)\/[\w@%+.-]+(?:\/[\w@%+.-]+)*\.[A-Za-z][A-Za-z0-9]{0,7})(?=$|[\s"'`):\]>,;])/gm

/**
 * Файлы репозитория из текста лога: относительные пути под известными
 * каталогами с расширением. Сознательно без «голых» имён (`package.json` без
 * каталога) — вывод npm и тестов забил бы список шумом.
 */
export function extractImprovementFiles(text: string, limit = 20): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(IMPROVEMENT_FILE_PATTERN)) {
    const path = match[1].replace(/[.,;:]+$/, '')
    if (path.includes('node_modules/') || path.includes('..')) continue
    found.add(path)
    if (found.size >= limit) break
  }
  return [...found]
}

export interface CiCommandSuggestion {
  id: string
  commandId: string
  runStepId: string | null
  /** Причина → предлагаемое изменение (текст). */
  reason: string
  /** Полный текст предлагаемой версии скрипта. */
  proposedScript: string
  status: CiSuggestionStatus
  /** Сколько раз встречалась однотипная рекомендация по этой команде. */
  occurrences: number
  createdAt: number
  resolvedBy: string | null
  resolvedAt: number | null
}

// --- Метрики -------------------------------------------------------------

/** Метрика по команде × проект (окно metrics_window). */
export interface CiCommandMetric {
  projectId: string
  commandId: string
  medianMs: number | null
  avgMs: number | null
  p90Ms: number | null
  /** Число успешных ранов, попавших в окно длительности. */
  samples: number
  /** Доля успехов по всем ранам команды в окне. */
  successRate: number
}

/** Метрика работы модели: среднее по последним 10 длительностям. */
export interface CiModelWorkMetric {
  projectId: string
  avgMs: number | null
  samples: number
}

// --- Аудит / история -----------------------------------------------------

export type CiEventActor = 'user' | 'model' | 'system'

export interface CiEvent {
  id: string
  projectId: string
  runId: string | null
  commandId: string | null
  type: string
  actorType: CiEventActor
  actorId: string | null
  payload: Record<string, unknown>
  createdAt: number
}

// --- Диагностическая консоль (US-6) --------------------------------------

export type CiConsoleMode = 'read_only' | 'edit'

/** Запрос выполнения команды в консоли рана. */
export interface CiConsoleExecRequest {
  runId: string
  command: string
}

export interface CiConsoleExecResult {
  output: string
  exitCode: number | null
  /** Команда отклонена белым списком read-only режима. */
  rejected: boolean
  message: string
}

// --- Realtime payload'ы (полезная нагрузка WS ci.*-сообщений) ------------

/** Причина завершения рана — для UI-заключения. */
export type CiFailureClass =
  | 'no_access'
  | 'no_secret'
  | 'version_mismatch'
  | 'script_error'
  | 'external_unavailable'
  | 'insufficient_permissions'
  | 'unknown'

/** Заключение модели при Исходе B. */
export interface CiRunConclusion {
  failureClass: CiFailureClass
  /** Что нужно от человека. */
  summary: string
}

// --- Расход модели и отчёт по задаче -------------------------------------

/**
 * За какой ход CLI записан расход. Один ход = один «запрос к модели»: работа
 * модели (включая продолжения одной сессии), резюме рана, попытка fix-loop и
 * шаг актуализации базы знаний идут через один и тот же `runTurn`.
 */
export type CiUsageKind =
  | 'planning'
  | 'model_work'
  | 'fix'
  | 'qa_analysis'
  | 'data_preparation'
  | 'code_review'
  | 'kb_update'
  | 'release_analysis'
  | 'summary'

export const CI_USAGE_KINDS: CiUsageKind[] = [
  'planning', 'model_work', 'fix', 'qa_analysis', 'data_preparation',
  'code_review', 'kb_update', 'release_analysis', 'summary'
]

/** Подписи стадий: одни и те же в настройках моделей и в отчёте по рану. */
export const CI_USAGE_KIND_LABELS: Record<CiUsageKind, string> = {
  planning: 'Планирование',
  model_work: 'Разработка',
  fix: 'Исправление тестов',
  qa_analysis: 'Анализ ручного QA',
  data_preparation: 'Подготовка данных',
  code_review: 'Code review',
  kb_update: 'Актуализация базы знаний',
  release_analysis: 'Релизный анализ',
  summary: 'Резюме'
}

/**
 * Что означает `inputTokens` строки расхода. `no_cache` — «вход без кэша»: то,
 * что оплачивается по полной цене входа (у claude так всегда, у codex — после
 * приведения на записи). `with_cache` — исторические строки codex: там CLI
 * включал прочитанный из кэша ввод в `input_tokens`, и складывать их с claude
 * нельзя. Историю задним числом не правим, поэтому семантику различаем на чтении.
 */
export type CiInputSemantics = 'no_cache' | 'with_cache'

/** Расход одного хода модели внутри рана (строка `ci_run_usage`). */
export interface CiRunUsage {
  id: string
  runId: string
  /** Шаг ленты, внутри которого шёл ход; null — шаг уже удалён. */
  stepId: string | null
  kind: CiUsageKind
  provider: CiLlmProvider
  /** Модель хода: то, что вернул CLI, иначе выбранная для рана. */
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** Семантика `inputTokens` этой строки — см. `CiInputSemantics`. */
  inputSemantics: CiInputSemantics
  /**
   * Стоимость, которую сообщил CLI (`total_cost_usd`). `null` — не сообщил:
   * тогда отчёт считает оценку по прайсу и помечает её «≈». В БД оценку не
   * храним, иначе смена цен переписывала бы историю задним числом.
   */
  costUsd: number | null
  /** Сколько ход занял по данным CLI; null — не сообщил. */
  durationMs: number | null
  /** Число внутренних ходов агента (`num_turns`). */
  numTurns: number | null
  at: number
}

/** Итог по строкам расхода: сколько запросов, токенов, денег и времени модели. */
export interface CiUsageTotals {
  /** Число запросов к модели (ходов CLI). */
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** Сумма всех видов токенов — для компактного «N токенов». */
  tokens: number
  /** Стоимость в USD; null — считать не из чего (ни CLI, ни прайса). */
  costUsd: number | null
  /** Хотя бы одно слагаемое — оценка (или его вовсе не посчитать): в UI «≈». */
  costEstimated: boolean
  /**
   * У части ходов прайса нет вовсе (модель `unknown`), поэтому итог заведомо
   * НИЖЕ настоящего — это не то же самое, что «оценка по прайсу», и в UI
   * говорится отдельно.
   */
  costUnderstated: boolean
  /**
   * Часть строк пришла в старой семантике входа (codex до приведения) и была
   * пересчитана на чтении: суммы сравнимы, но получены не из БД как есть.
   */
  inputNormalized: boolean
  /** Суммарное время работы модели, мс (сумма длительностей ходов). */
  modelActiveMs: number
  /**
   * Сколько запросов к API стояло за ходами (`num_turns`): вызов инструмента —
   * это новый запрос со всем накопленным контекстом, и именно на это число
   * умножается размер контекста в цене хода. 0 — CLI не сказал ни по одному ходу
   * (codex), тогда контекст на запрос не считается.
   */
  apiRequests: number
  /**
   * Самый тяжёлый контекст на запрос среди ходов (токенов). Средний считает
   * `ciAvgContextPerRequest`; максимум показывает, до чего контекст дорос к концу
   * хода — по среднему разбухание не видно.
   */
  maxContextPerRequest: number
}

export const EMPTY_CI_USAGE_TOTALS: CiUsageTotals = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  tokens: 0,
  costUsd: null,
  costEstimated: false,
  costUnderstated: false,
  inputNormalized: false,
  modelActiveMs: 0,
  apiRequests: 0,
  maxContextPerRequest: 0
}

/**
 * Входная сторона хода — то, что оплачивается как «контекст»: вход без кэша плюс
 * чтение кэша плюс его запись (запись — тот же контекст, просто в первый проход).
 * Выход сюда не входит: он не перечитывается на следующем запросе.
 */
export function ciContextTokens(row: Pick<CiRunUsage, 'inputTokens' | 'inputSemantics' | 'cacheReadTokens' | 'cacheCreationTokens'>): number {
  return ciUsageInputTokens(row) + row.cacheReadTokens + row.cacheCreationTokens
}

/**
 * Средний контекст на один запрос к API — второй множитель цены хода. `null`,
 * когда число запросов неизвестно: ноль на его месте читался бы как «контекста
 * не было».
 */
export function ciAvgContextPerRequest(t: CiUsageTotals): number | null {
  if (t.apiRequests <= 0) return null
  return Math.round((t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens) / t.apiRequests)
}

/**
 * «Вход без кэша» строки: исторические строки codex несут вход ВМЕСТЕ с
 * прочитанным кэшем, поэтому их приводят к общей семантике вычитанием (с
 * зажимом в ноль — на случай, если CLI когда-нибудь начнёт считать иначе).
 * Строки, записанные уже приведёнными, остаются как есть.
 */
export function ciUsageInputTokens(row: Pick<CiRunUsage, 'inputTokens' | 'inputSemantics' | 'cacheReadTokens'>): number {
  return row.inputSemantics === 'with_cache'
    ? Math.max(0, row.inputTokens - row.cacheReadTokens)
    : row.inputTokens
}

/**
 * Итог по ходам. Стоимость берётся от CLI, а если её нет — оценивается по
 * прайсу (`estimateCostUsd`), и тогда весь итог помечается `costEstimated`.
 * Неизвестная модель (прайса нет) тоже делает итог приблизительным: сумма
 * заведомо занижена (`costUnderstated`), и показывать её точным числом нельзя.
 * Вход считается в одной семантике — «без кэша»: смешивать движки в одной сумме
 * нельзя, иначе «до/после» сравнивает разные величины.
 */
export function ciUsageTotals(rows: CiRunUsage[]): CiUsageTotals {
  const t: CiUsageTotals = { ...EMPTY_CI_USAGE_TOTALS }
  let cost: number | null = null
  for (const r of rows) {
    t.requests++
    const inputTokens = ciUsageInputTokens(r)
    if (inputTokens !== r.inputTokens) t.inputNormalized = true
    t.inputTokens += inputTokens
    t.outputTokens += r.outputTokens
    t.cacheReadTokens += r.cacheReadTokens
    t.cacheCreationTokens += r.cacheCreationTokens
    t.modelActiveMs += r.durationMs ?? 0
    // Запросы к API считаются отдельно от ходов CLI: один ход — это десятки
    // запросов (по одному на каждый вызов инструмента), и цена хода равна
    // «размер контекста × число запросов».
    if (r.numTurns && r.numTurns > 0) {
      t.apiRequests += r.numTurns
      t.maxContextPerRequest = Math.max(t.maxContextPerRequest, Math.round(ciContextTokens(r) / r.numTurns))
    }
    // Оценка идёт по приведённому входу: у старой строки codex он включал кэш,
    // и цена по полному тарифу завышала итог в разы.
    const own = r.costUsd ?? estimateCostUsd(r.model, { ...r, inputTokens })
    if (own == null) {
      t.costEstimated = true
      t.costUnderstated = true
    } else {
      cost = (cost ?? 0) + own
      if (r.costUsd == null) t.costEstimated = true
    }
  }
  t.tokens = t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreationTokens
  t.costUsd = cost
  return t
}

/** Расход одной стадии рана, посчитанной одной моделью. */
export interface CiUsageStage {
  kind: CiUsageKind
  /** Модель ходов; у стадии их бывает несколько (смена настройки, повтор рана). */
  model: string
  totals: CiUsageTotals
}

/**
 * Разбивка расхода по стадиям и моделям. Смысл — увидеть, чем считалась каждая
 * стадия и во что она обошлась: с моделью по стадии «$16 за ран» без разбивки
 * больше ничего не объясняет. Группировка по паре (стадия, модель), а не по
 * стадии: одна и та же стадия в разных ранах и после смены настройки идёт на
 * разных моделях, и складывать их в одну цену нельзя. Порядок — как в
 * `CI_USAGE_KINDS`, внутри стадии — по первому появлению.
 */
export function ciUsageStages(rows: CiRunUsage[]): CiUsageStage[] {
  const groups = new Map<string, { kind: CiUsageKind; model: string; rows: CiRunUsage[] }>()
  for (const r of rows) {
    const key = `${r.kind} ${r.model}`
    const g = groups.get(key) ?? { kind: r.kind, model: r.model, rows: [] }
    g.rows.push(r)
    groups.set(key, g)
  }
  return [...groups.values()]
    .sort((a, b) => CI_USAGE_KINDS.indexOf(a.kind) - CI_USAGE_KINDS.indexOf(b.kind))
    .map((g) => ({ kind: g.kind, model: g.model, totals: ciUsageTotals(g.rows) }))
}

/** Сложить готовые итоги (шаги рана, раны задачи). */
export function sumCiUsageTotals(list: CiUsageTotals[]): CiUsageTotals {
  const t: CiUsageTotals = { ...EMPTY_CI_USAGE_TOTALS }
  let cost: number | null = null
  for (const s of list) {
    t.requests += s.requests
    t.inputTokens += s.inputTokens
    t.outputTokens += s.outputTokens
    t.cacheReadTokens += s.cacheReadTokens
    t.cacheCreationTokens += s.cacheCreationTokens
    t.tokens += s.tokens
    t.modelActiveMs += s.modelActiveMs
    t.apiRequests += s.apiRequests
    // Максимум — именно максимум, а не сумма: это «самый дорогой запрос».
    t.maxContextPerRequest = Math.max(t.maxContextPerRequest, s.maxContextPerRequest)
    if (s.costEstimated) t.costEstimated = true
    if (s.costUnderstated) t.costUnderstated = true
    if (s.inputNormalized) t.inputNormalized = true
    if (s.costUsd != null) cost = (cost ?? 0) + s.costUsd
  }
  t.costUsd = cost
  return t
}

// --- Вызовы инструментов за ран -------------------------------------------

/**
 * Вид инструмента в счётчике вызовов. Смысл разбивки — проверяемая гипотеза
 * CHAT-54: файлы читаются `read`/`grep` и правятся `edit`, а `bash` остаётся для
 * команд. Пока чтение шло `cat` внутри `bash`, весь файл попадал в контекст, и
 * ход стоил в разы дороже. `kb` — обращения к базе знаний инструментом.
 *
 * `denied` стоит особняком: это не инструмент, а исход вызова — отказ (вызов
 * упёрся в неодобренное разрешение CLI либо его отклонил remote-мост). Отказы
 * были видны только в сырой ленте, а без счётчика неотличимы от «модель этим
 * инструментом не пользуется».
 */
export type CiToolKind = 'bash' | 'read' | 'grep' | 'edit' | 'kb' | 'other' | 'denied'

export const CI_TOOL_KINDS: CiToolKind[] = ['bash', 'read', 'grep', 'edit', 'kb', 'other', 'denied']

/**
 * Виды, из которых складывается «всего вызовов». `denied` не входит: сам вызов
 * уже посчитан своим видом, и сумма с отказами считала бы его дважды.
 */
export const CI_TOOL_CALL_KINDS: CiToolKind[] = ['bash', 'read', 'grep', 'edit', 'kb', 'other']

/** Сколько раз за ран вызван инструмент каждого вида. */
export type CiToolCalls = Record<CiToolKind, number>

export const EMPTY_CI_TOOL_CALLS: CiToolCalls = { bash: 0, read: 0, grep: 0, edit: 0, kb: 0, other: 0, denied: 0 }

/**
 * Отказ ли это, а не обычная ошибка команды. Считается по тексту результата —
 * единственному, что о вызове известно и claude, и codex: имени инструмента в
 * `tool_result` нет. Список маркеров узкий намеренно: упавший `npm test` или
 * `ENOENT` отказом не являются, и записать их в отказы хуже, чем недосчитать.
 */
export function isCiToolDenial(text: string): boolean {
  if (!text) return false
  return (
    /requested permissions/i.test(text) || // claude -p: «…but you haven't granted it yet»
    /haven'?t granted/i.test(text) ||
    /Отклонено:/.test(text) || // remote-мост: режим «План» и чтение файла через bash
    /tool use was (?:denied|rejected)/i.test(text)
  )
}

/**
 * Вид инструмента по имени, которым его назвал CLI. Форматы у движков разные, а
 * вызов — один и тот же: `mcp__remote__read` (claude), `remote:read` (codex),
 * `Read` (встроенный инструмент хода без машины). Сервер MCP в имени важнее
 * тула: `mcp__kb__search` — это обращение к базе знаний, а не «поиск».
 */
export function classifyCiToolCall(name: string): CiToolKind {
  const raw = name.trim()
  if (!raw) return 'other'
  const parts = raw.match(/^mcp__(.+?)__(.+)$/) ?? raw.match(/^([^:\s]+):(.+)$/)
  const server = (parts ? parts[1] : '').toLowerCase()
  const tool = (parts ? parts[2] : raw).toLowerCase()
  if (server === 'kb') return 'kb'
  switch (tool) {
    case 'bash':
    case 'shell':
      return 'bash'
    case 'read':
      return 'read'
    case 'grep':
      return 'grep'
    case 'edit':
    case 'write':
    case 'multiedit':
      return 'edit'
    default:
      return 'other'
  }
}

/** Счётчик по именам инструментов (имена — как их назвал CLI). */
export function countCiToolCalls(names: Iterable<string>): CiToolCalls {
  const calls: CiToolCalls = { ...EMPTY_CI_TOOL_CALLS }
  for (const name of names) calls[classifyCiToolCall(name)]++
  return calls
}

/** Всего вызовов — сумма по видам инструментов (отказы считаются отдельно). */
export function ciToolCallsTotal(calls: CiToolCalls): number {
  return CI_TOOL_CALL_KINDS.reduce((acc, kind) => acc + calls[kind], 0)
}

/** Есть ли что записывать: ход мог состоять из одних отказов. */
export function ciToolCallsAny(calls: CiToolCalls): boolean {
  return ciToolCallsTotal(calls) > 0 || calls.denied > 0
}

/**
 * Сложить счётчики ранов. `null` — ни у одного рана счётчика нет (метрики тогда
 * ещё не было): ноль на её месте читался бы как «модель не вызвала ничего».
 */
export function sumCiToolCalls(list: Array<CiToolCalls | null>): CiToolCalls | null {
  const known = list.filter((c): c is CiToolCalls => c !== null)
  if (!known.length) return null
  const sum: CiToolCalls = { ...EMPTY_CI_TOOL_CALLS }
  for (const c of known) for (const kind of CI_TOOL_KINDS) sum[kind] += c[kind]
  return sum
}

// --- Объём ответов инструментов -------------------------------------------

/**
 * Сколько СИМВОЛОВ ответов инструментов легло в контекст хода, по видам. Число
 * вызовов само по себе о цене не говорит: 40 окон `read` дешевле одного `npm ci`,
 * вывод которого потом перечитывается на каждом следующем запросе. Символы, а не
 * токены: сервер видит ровно текст, а токенизация — дело модели (оценка —
 * `estimateKbTokens`, та же, что у базы знаний).
 */
export type CiToolChars = Record<CiToolKind, number>

export const EMPTY_CI_TOOL_CHARS: CiToolChars = { bash: 0, read: 0, grep: 0, edit: 0, kb: 0, other: 0, denied: 0 }

/** Всего символов ответов — по видам инструментов (`denied` — исход, не вид). */
export function ciToolCharsTotal(chars: CiToolChars): number {
  return CI_TOOL_CALL_KINDS.reduce((acc, kind) => acc + chars[kind], 0)
}

/** Сложить объёмы ранов; `null` — ни у одного рана метрики нет (ран до фичи). */
export function sumCiToolChars(list: Array<CiToolChars | null>): CiToolChars | null {
  const known = list.filter((c): c is CiToolChars => c !== null)
  if (!known.length) return null
  const sum: CiToolChars = { ...EMPTY_CI_TOOL_CHARS }
  for (const c of known) for (const kind of CI_TOOL_KINDS) sum[kind] += c[kind]
  return sum
}

/**
 * Один тяжёлый ответ инструмента за ран — чтобы «контекст раздулся» имело
 * виновника с именем: что вызвали и сколько символов это стоило.
 */
export interface CiRunToolResponse {
  /** Имя инструмента ровно как его назвал CLI (`mcp__remote__bash`). */
  tool: string
  kind: CiToolKind
  /** Что вызывали: команда/путь/паттерн — как в ленте, обрезанное. */
  label: string
  /** Сколько символов ушло в контекст. */
  chars: number
  /** Сколько было до обрезки; `null` — ответ не обрезался. */
  originalChars: number | null
  /** Шаг ленты, внутри которого шёл вызов; null — шага уже нет. */
  stepId: string | null
  at: number
}

/** Сколько тяжёлых ответов храним на ран (метрика, а не архив ленты). */
export const CI_TOOL_RESPONSES_KEEP = 5

/** Сколько показываем в отчёте: три самых тяжёлых. */
export const CI_TOOL_RESPONSES_SHOWN = 3

/** Самые тяжёлые ответы из нескольких списков (раны задачи, ходы). */
export function topCiToolResponses(list: CiRunToolResponse[], limit = CI_TOOL_RESPONSES_SHOWN): CiRunToolResponse[] {
  return [...list].sort((a, b) => b.chars - a.chars || a.at - b.at).slice(0, limit)
}

/** Шаг рана в отчёте: то же, что в ленте, плюс расход ходов модели. */
export interface CiRunReportStep {
  id: string
  parentStepId: string | null
  title: string
  slot: CiSlot | null
  kind: CiStepKind
  initiatedBy: CiInitiatedBy
  status: CiStatus
  attempt: number
  fixedByModel: boolean
  exitCode: number | null
  durationMs: number | null
  /** Расход ходов модели этого шага; null — ходов в нём не было. */
  usage: CiUsageTotals | null
}

/** Насколько выданные разделы БЗ совпали с файлами, открытыми моделью. */
export interface CiKbHitMetric {
  sectionsDelivered: number
  sectionsHit: number
  hitRatio: number
}

/** Отчёт по одному завершённому (или остановленному) рану. */
export interface CiRunReport {
  runId: string
  projectId: string
  taskId: string
  status: CiStatus
  mode: CiRunMode
  provider: CiLlmProvider
  /** Модель, выбранная для рана (у ходов она может отличаться — см. строки расхода). */
  model: string
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
  createdAt: number
  /** Сколько раз модель бралась чинить упавшие шаги. */
  fixAttempts: number
  totals: CiUsageTotals
  /** Расход по стадиям рана и моделям, которыми они считались. */
  stages: CiUsageStage[]
  steps: CiRunReportStep[]
  /** null — БЗ ничего не выдала либо метрика для старого/незавершённого рана не считалась. */
  kbHit: CiKbHitMetric | null
  /**
   * Вызовы инструментов модели за ран. `null` — у рана счётчика нет (сделан до
   * фичи): нули на его месте читались бы как «модель не вызвала ничего».
   */
  toolCalls: CiToolCalls | null
  /**
   * Символы ответов инструментов по видам — измеренный вклад в контекст хода.
   * `null` — метрики у рана нет (ран до неё).
   */
  toolChars: CiToolChars | null
  /** Самые тяжёлые ответы инструментов рана (от тяжёлого к легкому); [] — нет. */
  toolResponses: CiRunToolResponse[]
}

/** Отчёт по задаче: все её раны (повторы, отмены) и итог по ним. */
export interface CiTaskReport {
  projectId: string
  taskId: string
  /** Раны от свежего к старому. */
  runs: CiRunReport[]
  totals: CiUsageTotals
  /** Суммарное время ранов задачи, мс. */
  durationMs: number
  /** Вызовы инструментов по всем ранам; `null` — счётчика нет ни у одного. */
  toolCalls: CiToolCalls | null
  /** Объём ответов по всем ранам; `null` — метрики нет ни у одного. */
  toolChars: CiToolChars | null
  /** Самые тяжёлые ответы среди всех ранов задачи. */
  toolResponses: CiRunToolResponse[]
}

/** Итог по задаче — сумма по всем её ранам (чистая функция, без БД). */
export function ciTaskTotals(runs: CiRunReport[]): {
  totals: CiUsageTotals
  durationMs: number
  toolCalls: CiToolCalls | null
  toolChars: CiToolChars | null
  toolResponses: CiRunToolResponse[]
} {
  return {
    totals: sumCiUsageTotals(runs.map((r) => r.totals)),
    durationMs: runs.reduce((acc, r) => acc + (r.durationMs ?? 0), 0),
    toolCalls: sumCiToolCalls(runs.map((r) => r.toolCalls)),
    toolChars: sumCiToolChars(runs.map((r) => r.toolChars)),
    toolResponses: topCiToolResponses(runs.flatMap((r) => r.toolResponses))
  }
}

/** Отдельный полный прогон проверок, неизменно привязанный к одному commit SHA. */
export type TestRunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped' | 'awaiting_input'
export type TestGroupStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled' | 'not_applicable'
export type TestGroupKind = 'typecheck' | 'contract' | 'server' | 'ui' | 'build' | 'storybook' | 'playwright_smoke' | 'playwright_regression' | 'custom'
export type TestSkipReason = 'blocked_by_failure' | 'cancelled' | 'not_applicable'
export type TestFailureKind = 'product' | 'infrastructure' | 'parser'

export interface TestGroupConfig {
  id: string
  name: string
  kind: TestGroupKind
  command: string
  commandVersion: number
  position: number
  required: boolean
  applicability?: 'always' | 'ui_changes' | 'browser_verifiable'
}

export interface TestArtifact {
  id: string
  kind: 'html_report' | 'trace' | 'screenshot' | 'video' | 'log' | 'other'
  name: string
  url: string
}

export interface TestFailure {
  kind: TestFailureKind
  packageName: string | null
  runner: string | null
  file: string | null
  suite: string | null
  testName: string | null
  message: string
  stack: string | null
  expected: string | null
  actual: string | null
  logExcerpt: string | null
  tracePath: string | null
  screenshotPath: string | null
  retryCommand: string | null
}

export interface TestCounters {
  suites: number | null
  tests: number | null
  passed: number
  failed: number
  skipped: number
}

export const EMPTY_TEST_COUNTERS: TestCounters = { suites: null, tests: null, passed: 0, failed: 0, skipped: 0 }

export interface TestNotApplicableDecision {
  reason: string
  decidedBy: string
  decidedAt: number
  commitSha: string
  alternativeVerification: string
  automatic: boolean
}

export interface TestGroupRun {
  id: string
  testRunId: string
  configId: string
  name: string
  kind: TestGroupKind
  command: string
  commandVersion: number
  position: number
  required: boolean
  status: TestGroupStatus
  commitSha: string
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
  exitCode: number | null
  counters: TestCounters
  currentSuite: string | null
  currentTest: string | null
  progress: number | null
  log: string
  failures: TestFailure[]
  artifacts: TestArtifact[]
  skipReason: TestSkipReason | null
  notApplicable: TestNotApplicableDecision | null
  browserProject: string | null
  baseUrl: string | null
  testData: string | null
}

export interface TestRun {
  id: string
  projectId: string
  taskId: string
  branch: string
  commitSha: string
  workspace: string
  agentId: string | null
  previewId: string | null
  previewCommitSha: string | null
  analysisModel: string
  triggeredBy: string
  attempt: number
  previousRunId: string | null
  status: TestRunStatus
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
  currentGroupId: string | null
  groups: TestGroupRun[]
}

export interface TestGroupResult {
  exitCode: number | null
  counters?: Partial<TestCounters>
  failures?: TestFailure[]
  artifacts?: TestArtifact[]
  parserError?: string | null
  infrastructureFailure?: TestFailure | null
}

export interface TestProgressPatch {
  currentSuite?: string | null
  currentTest?: string | null
  progress?: number | null
  counters?: Partial<TestCounters>
}

export const BASE_TEST_PIPELINE: readonly Omit<TestGroupConfig, 'command' | 'commandVersion'>[] = [
  { id: 'typecheck', name: 'Typecheck', kind: 'typecheck', position: 10, required: true, applicability: 'always' },
  { id: 'shared-contract', name: 'Shared и contract tests', kind: 'contract', position: 20, required: true, applicability: 'always' },
  { id: 'server', name: 'Server tests', kind: 'server', position: 30, required: true, applicability: 'always' },
  { id: 'ui', name: 'UI unit и DOM tests', kind: 'ui', position: 40, required: true, applicability: 'ui_changes' },
  { id: 'build', name: 'Build затронутых приложений', kind: 'build', position: 50, required: true, applicability: 'always' },
  { id: 'storybook', name: 'Storybook build и smoke', kind: 'storybook', position: 60, required: false, applicability: 'ui_changes' },
  { id: 'playwright-smoke', name: 'Playwright smoke', kind: 'playwright_smoke', position: 70, required: false, applicability: 'browser_verifiable' },
  { id: 'playwright-regression', name: 'Playwright regression', kind: 'playwright_regression', position: 80, required: false, applicability: 'browser_verifiable' }
]

const TEST_GROUP_TRANSITIONS: Record<TestGroupStatus, readonly TestGroupStatus[]> = {
  queued: ['running', 'skipped', 'cancelled', 'not_applicable'],
  running: ['passed', 'failed', 'cancelled'],
  passed: [], failed: [], skipped: [], cancelled: [], not_applicable: []
}

export function canTransitionTestGroup(from: TestGroupStatus, to: TestGroupStatus): boolean {
  return TEST_GROUP_TRANSITIONS[from].includes(to)
}
export function isTerminalTestRun(status: TestRunStatus): boolean {
  return status === 'passed' || status === 'failed' || status === 'cancelled' || status === 'skipped'
}
export function assertSingleRunningGroup(groups: readonly Pick<TestGroupRun, 'status'>[]): void {
  if (groups.filter((group) => group.status === 'running').length > 1) throw new Error('Одновременно может выполняться только одна группа')
}
export function blockedGroupsAfterFailure(groups: readonly TestGroupRun[], failedGroupId: string): TestGroupRun[] {
  let after = false
  return groups.map((group) => {
    if (group.id === failedGroupId) after = true
    return after && group.id !== failedGroupId && group.status === 'queued'
      ? { ...group, status: 'skipped', skipReason: 'blocked_by_failure' }
      : group
  })
}
export function mayMarkGroupNotApplicable(
  group: Pick<TestGroupConfig, 'kind' | 'required'>,
  role: 'owner' | 'tester' | 'member' | 'model',
  decision: Pick<TestNotApplicableDecision, 'reason' | 'alternativeVerification'>
): boolean {
  if (group.required || !decision.reason.trim() || !decision.alternativeVerification.trim()) return false
  const playwright = group.kind === 'playwright_smoke' || group.kind === 'playwright_regression'
  return !playwright || role === 'owner' || role === 'tester'
}
export function sameTestRunRevision(a: Pick<TestRun, 'commitSha'>, b: Pick<TestRun, 'commitSha'>): boolean {
  return a.commitSha === b.commitSha
}

// --- Межстадийный цикл исправления продуктовых падений ---------------------

export const DEFAULT_TEST_FIX_CYCLE_LIMIT = 10
export type TestFailureClassification =
  | 'product_failure' | 'infrastructure_failure' | 'configuration_failure' | 'cancelled' | 'unknown'
export type TestFixCycleStatus =
  | 'queued' | 'running' | 'target_failed' | 'target_passed' | 'awaiting_full_test'
  | 'resolved' | 'same_failure' | 'new_failure' | 'model_failed' | 'blocked'
  | 'cancelled' | 'limit_exhausted'

export interface TestFailureDiagnostic extends TestFailure {
  fingerprint: string
  groupId: string
  groupName: string
  command: string
  exitCode: number | null
  commitSha: string
  artifacts: TestArtifact[]
}

export interface TestFixTargetedRun {
  id: string
  command: string
  status: 'running' | 'passed' | 'failed' | 'cancelled'
  exitCode: number | null
  log: string
  startedAt: number
  finishedAt: number | null
}

export interface TestFixCycle {
  id: string
  projectId: string
  taskId: string
  testRunId: string
  failedGroupId: string
  sourceCommitSha: string
  attemptNo: number
  effectiveLimit: number
  status: TestFixCycleStatus
  classification: TestFailureClassification
  failures: TestFailureDiagnostic[]
  llm: CiStageLlmSnapshot
  sessionId: string | null
  diagnosis: string
  action: string
  changedFiles: string[]
  fixCommitSha: string | null
  targetedRuns: TestFixTargetedRun[]
  nextTestRunId: string | null
  fullTestResult: 'passed' | 'same_failure' | 'new_failure' | 'infrastructure_failure' | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  blockedReason: string | null
}

export interface TestFixTaskState {
  taskId: string
  usedAttempts: number
  overrideLimit: number | null
  activeCycleId: string | null
}

/** Настройка проекта: целое число >= 0; отсутствие значения означает дефолт 10. */
export function normalizeTestFixCycleLimit(value: unknown): number {
  if (value == null || value === '') return DEFAULT_TEST_FIX_CYCLE_LIMIT
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('Лимит возвратов должен быть целым числом не меньше 0')
  }
  return value
}

/** Убирает нестабильные части сообщения, сохраняя смысл ошибки. */
export function normalizeTestFailureMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/(?:[a-z]:)?[\\/](?:[^\s:'"()]+[\\/])*tmp[\\/][^\s:'"()]+/gi, '<tmp>')
    .replace(/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}\b/g, '<host>:<port>')
    .replace(/\bport\s+\d{2,5}\b/g, 'port <port>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<uuid>')
    .replace(/\b(?:0x)?[0-9a-f]{12,}\b/gi, '<id>')
    .replace(/\b\d{4}-\d\d-\d\d[t ]\d\d:\d\d:\d\d(?:\.\d+)?z?\b/gi, '<time>')
    .replace(/\b\d+(?:\.\d+)?\s?ms\b/g, '<duration>')
    .replace(/\s+/g, ' ')
    .trim()
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function testFailureFingerprint(failure: Pick<TestFailure, 'runner' | 'packageName' | 'file' | 'suite' | 'testName' | 'message'>): string {
  const stable = [
    failure.runner, failure.packageName, failure.file?.replace(/\\/g, '/'),
    failure.suite, failure.testName, normalizeTestFailureMessage(failure.message)
  ].map((value) => (value ?? '').trim().toLowerCase()).join('\n')
  return `tf-${stableHash(stable)}`
}

const INFRA_FAILURE_RE = /machine (?:is )?offline|машин[аы].*(?:не в сети|отключ)|connection (?:lost|reset)|econnreset|enospc|no space left|docker (?:is )?unavailable|cannot connect to the docker|address already in use|eaddrinuse|external timeout|timed out before (?:test|runner)|npm.*_cacache/i
const CONFIG_FAILURE_RE = /configuration (?:error|invalid)|invalid config|unknown option|missing (?:environment|env) variable|command not found|no test files found/i
const PRODUCT_FAILURE_RE = /(?:test|tests|suite|assertion).*(?:fail|failed)|expected .+ (?:to|but)|typecheck|type error|ts\d{4}|build failed|storybook|playwright|contract/i

/** Консервативная классификация: unknown никогда не превращается в авто-фикс. */
export function classifyTestFailure(input: {
  exitCode: number | null
  message?: string | null
  log?: string | null
  cancelled?: boolean
  infrastructure?: boolean
}): TestFailureClassification {
  if (input.cancelled) return 'cancelled'
  if (input.infrastructure) return 'infrastructure_failure'
  const text = `${input.message ?? ''}\n${input.log ?? ''}`
  if (INFRA_FAILURE_RE.test(text) || input.exitCode == null && /timeout|runner.*(?:did not|failed to) start/i.test(text)) return 'infrastructure_failure'
  if (CONFIG_FAILURE_RE.test(text)) return 'configuration_failure'
  if (input.exitCode !== 0 && PRODUCT_FAILURE_RE.test(text)) return 'product_failure'
  return 'unknown'
}

export function compareFixFailureFingerprints(
  previous: readonly Pick<TestFailureDiagnostic, 'fingerprint'>[],
  current: readonly Pick<TestFailureDiagnostic, 'fingerprint'>[]
): 'same_failure' | 'new_failure' {
  const old = new Set(previous.map((failure) => failure.fingerprint))
  return current.some((failure) => old.has(failure.fingerprint)) ? 'same_failure' : 'new_failure'
}

/** Серверно проверяемая точечная команда; shell-операторы и repository gate запрещены. */
export function isSafeTargetedTestCommand(command: string): boolean {
  const value = command.trim()
  if (!value || /[;&|><`\n\r]|\$\(|\b(?:merge|deploy|rm\s+-rf|git\s+(?:clean|reset))\b/i.test(value)) return false
  if (/affected-check|\bnpm\s+(?:run\s+)?(?:test|build|typecheck)\s*$/i.test(value)) return false
  return /(?:\.test\.[a-z0-9]+|\.spec\.[a-z0-9]+|--testnamepattern|--test-name-pattern|-t\s+\S|typecheck\b.*(?:-w|--workspace|--project))/i.test(value)
}
