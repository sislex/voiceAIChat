/** Контракт read-only базы знаний проекта voiceAIChat. */
import type { KbContextMode } from './types'

/**
 * Раздел базы знаний. Разделы отличаются не темой, а видимостью:
 *  - `usage`   — как пользоваться ChatAI; общая для всех пользователей;
 *  - `user`    — персональные знания о настройках/предпочтениях; видит владелец;
 *  - `project` — знания по разработке конкретного проекта; видят участники проекта.
 * Контроль доступа делает сервер (см. apps/server/src/kb/access.ts): раздел в
 * запросе — это фильтр, а не разрешение.
 */
export type KbScope = 'usage' | 'user' | 'project'

export const KB_SCOPES: readonly KbScope[] = ['usage', 'user', 'project'] as const

/** Подписи разделов для UI (одни на все экраны — иначе вкладки разъедутся). */
export const KB_SCOPE_LABELS: Record<KbScope, string> = {
  usage: 'Использование',
  user: 'Настройки пользователя',
  project: 'Разработка проекта'
}

export function isKbScope(value: unknown): value is KbScope {
  return value === 'usage' || value === 'user' || value === 'project'
}

export type KbDocumentKind = 'feature' | 'subsystem' | 'protocol' | 'decision' | 'convention' | 'runbook' | 'package'
export type KbFreshness = 'current' | 'stale' | 'unknown'
export type KbMatchType = 'symbol' | 'alias' | 'path' | 'protocol' | 'lexical' | 'semantic'

export interface KbStatus {
  available: boolean
  mode: 'source' | 'generated' | 'disabled'
  searchMode: 'lexical' | 'hybrid'
  version: string
  createdAt: string
  documents: number
  chunks: number
  staleDocuments: number
  error?: string
}
export interface KbDocumentSummary {
  id: string; title: string; kind: KbDocumentKind; tags: string[]; packages: string[]
  freshness: KbFreshness; sourcePath: string
  /** Раздел базы знаний (видимость документа). */
  scope: KbScope
  /** Проект статьи — только для `scope: 'project'`. */
  projectId?: string | null
  /** Документ хранится в БД (создан пользователем/моделью), а не в файлах репозитория. */
  editable?: boolean
}
export interface KbDocument extends KbDocumentSummary {
  updated?: string; body: string; symbols: string[]; protocols: string[]; areas: string[]; related: string[]
  headings: Array<{ title: string; anchor: string; level: number }>
}
export interface KbSearchResult {
  documentId: string; chunkId: string; title: string; heading: string; excerpt: string; score: number
  matchTypes: KbMatchType[]; explanation: string; freshness: KbFreshness; sourcePath: string; anchor: string
  symbols: string[]; relatedFiles: string[]
  /** Раздел документа-источника (UI показывает его меткой в выдаче). */
  scope?: KbScope
  projectId?: string | null
}
/**
 * Раздел context-бандла. Полный текст нужен авто-инъекции, но намеренно
 * отсутствует в KbSearchResult и ответе kb:search.
 */
export interface KbContextSection extends KbSearchResult {
  text: string
}
export interface KbSearchRequest {
  query: string; kinds?: KbDocumentKind[]; tags?: string[]; limit?: number
  /** Ограничить раздел; пусто — все доступные пользователю разделы. */
  scope?: KbScope
  /** Ограничить проект (только вместе со `scope: 'project'`). */
  projectId?: string | null
}

/** Черновик статьи для записи (создание/правка): id пустой — создать новую. */
export interface KbDocumentDraft {
  id?: string
  scope: KbScope
  projectId?: string | null
  title: string
  body: string
  kind?: KbDocumentKind
  tags?: string[]
  /** Пути в репозитории, за которыми следит статья (как `areas` во фронтматтере). */
  areas?: string[]
}

// --- «Исследовать проект» ------------------------------------------------
//
// Модель на машине проекта сканирует репозиторий, сверяет статьи раздела
// «Разработка проекта» с кодом и переписывает их. Операция длинная, поэтому
// REST отдаёт снапшот состояния, а UI опрашивает его.

export type KbResearchState = 'running' | 'done' | 'error'

export interface KbResearchRun {
  projectId: string
  state: KbResearchState
  /** Кто запустил (логин). */
  startedBy: string
  startedAt: number
  finishedAt: number | null
  /** Что модель сделала со статьями (для отчёта в UI). */
  documents: Array<{ id: string; title: string; action: 'created' | 'updated' }>
  /** Короткое резюме от модели (что изменилось). */
  note: string
  /** Режим «по изменениям с коммита»: sha, от которого сверяли (null — полный скан). */
  sinceSha?: string | null
  error: string | null
}
export interface KbContextBundle {
  query: string; confidence: 'high' | 'medium' | 'low'; autoInjectAllowed: boolean
  sections: KbContextSection[]; relatedFiles: string[]; relatedDocuments: string[]
  staleWarnings: string[]; estimatedTokens: number
}

// --- Телеметрия использования базы знаний моделью ------------------------
//
// Считаем ТОЛЬКО то, что видела модель: авто-инъекцию контекста сервером и
// вызовы MCP-инструментов БЗ. Ручной поиск человека по странице «База знаний»
// сюда не попадает — иначе метрика «сколько раз модель обращалась» врёт.

/** Кто обратился к БЗ: сервер (авто-инъекция) или модель через mcp__kb__*. */
export type KbUsageSource = 'auto' | 'tool_search' | 'tool_document' | 'tool_topics'
/** Итог обращения. `pending` живёт только в WS-кадре, в БД его нет. */
export type KbUsageStatus = 'pending' | 'delivered' | 'empty' | 'error'

/**
 * Оценка токенов по символам. Разложить `usage.inputTokens` хода на «сколько от
 * БЗ» нельзя — CLI отдаёт суммарный вход промпта, поэтому в панели показываются
 * точные СИМВОЛЫ и эта оценка, а не биллинговые токены. Одна функция на сервер и
 * UI, чтобы числа в них не разъехались.
 */
export function estimateKbTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4)
}

/** Раздел, реально отданный модели в одном обращении. */
export interface KbUsageSectionRef {
  documentId: string
  title: string
  heading: string
  anchor: string
  sourcePath: string
  /** Снимок areas документа на момент выдачи модели. */
  relatedFiles: string[]
  /** Символы именно этого раздела в отданном тексте. */
  chars: number
  estimatedTokens: number
  score: number | null
  matchTypes: KbMatchType[]
  freshness: KbFreshness
}

/** Одно обращение к БЗ (авто-инъекция хода либо вызов инструмента моделью). */
export interface KbUsageQuery {
  id: string
  /** Монотонный курсор внутри разговора: клиент отбрасывает кадры с seq ≤ lastSeq. */
  seq: number
  conversationId: string
  /** Проект НА МОМЕНТ обращения (чат может сменить проект позже). */
  projectId: string | null
  turnId: string | null
  messageId: string | null
  /**
   * Ран CI-раннера, в ходе которого случилось обращение (null — обычный чат).
   * Панель чата помечает такие обращения источником «CI-ран» и ведёт в ленту.
   */
  ciRunId: string | null
  /** Шаг ленты рана, к которому обращение относится (для привязки в ленте). */
  ciStepId: string | null
  source: KbUsageSource
  status: KbUsageStatus
  query: string
  confidence: 'high' | 'medium' | 'low' | null
  /** Текст реально дописан в промпт (авто-инъекция) либо возвращён инструменту. */
  injected: boolean
  sectionsCount: number
  /** Точная длина текста, пришедшего модели. */
  chars: number
  estimatedTokens: number
  /** Оценка бандла от самой БЗ (`KbContextBundle.estimatedTokens`). */
  bundleTokens: number | null
  /** Размер всего промпта хода — для доли «сколько из него от БЗ». */
  promptChars: number | null
  /** Суммарный вход хода (input + cacheRead + cacheCreation) — для контекста. */
  turnInputTokens: number | null
  durationMs: number | null
  error: string | null
  createdAt: number
  sections: KbUsageSectionRef[]
}

/** Раздел в агрегате: сколько раз запрашивался и сколько дал модели. */
export interface KbUsageSectionAggregate {
  documentId: string
  title: string
  heading: string
  anchor: string
  sourcePath: string
  freshness: KbFreshness
  times: number
  /** Из них авто-инъекцией сервера (остальное — запросы модели инструментом). */
  autoTimes: number
  chars: number
  estimatedTokens: number
  lastAt: number
  /** Сколько разных чатов запрашивали раздел (только в проектном отчёте). */
  conversations?: number
}

export interface KbUsageTotals {
  queries: number
  delivered: number
  empty: number
  errors: number
  /** Обращений от модели через mcp__kb__* (остальное — авто-инъекция). */
  toolQueries: number
  /** Сумма отданных разделов (с повторами). */
  sections: number
  /** Уникальных документов. */
  documents: number
  chars: number
  estimatedTokens: number
  /** Сумма promptChars ходов с обращением — база для доли БЗ в промпте. */
  promptChars: number
  lastAt: number | null
}

/** Отчёт по одному чату (снапшот REST; инкременты приходят кадром kb.usage). */
export interface KbUsageReport {
  conversationId: string
  projectId: string | null
  kbContextMode: KbContextMode
  /** MCP-инструмент БЗ включён на сервере (VC_KB_TOOL) и индекс доступен. */
  toolEnabled: boolean
  /** Индекс БЗ доступен (иначе панель объясняет пустоту конфигурацией). */
  available: boolean
  /** Последний seq в отчёте: отсечка для инкрементальных кадров. */
  lastSeq: number
  totals: KbUsageTotals
  sections: KbUsageSectionAggregate[]
  recent: KbUsageQuery[]
}

/** Агрегат по всем чатам проекта. */
export interface KbProjectUsageReport {
  projectId: string
  toolEnabled: boolean
  available: boolean
  totals: KbUsageTotals
  sections: KbUsageSectionAggregate[]
  /** Последние обращения по всем чатам проекта (новые сверху). */
  recent: KbUsageQuery[]
  conversations: Array<{
    conversationId: string
    title: string
    queries: number
    chars: number
    estimatedTokens: number
    lastAt: number
  }>
}


// --- Отчёты по работе модели в CI-ране -----------------------------------
//
// Те же итоги и разделы, что в чате, но срез другой: один ран (лента) и все
// раны задачи (модалка). Доступ — по членству в проекте рана/задачи, поэтому
// отчёты собирает сервер, а не UI из чатовой телеметрии.

/** Обращения к БЗ в рамках одного CI-рана. */
export interface KbRunUsageReport {
  runId: string
  projectId: string
  taskId: string
  /** Режим БЗ, зафиксированный в ране. */
  kbContextMode: KbContextMode
  /** Связанный чат рана (null — телеметрия не писалась). */
  conversationId: string | null
  totals: KbUsageTotals
  sections: KbUsageSectionAggregate[]
  recent: KbUsageQuery[]
}

/** Агрегат по всем ранам задачи (модалка задачи). */
export interface KbTaskUsageReport {
  projectId: string
  taskId: string
  /** Сколько ранов задачи дали хотя бы одно обращение. */
  runs: number
  totals: KbUsageTotals
  sections: KbUsageSectionAggregate[]
  recent: KbUsageQuery[]
}

/**
 * Строка итогов по БЗ для резюме рана и коротких блоков UI. Одна функция на
 * сервер и UI: иначе «3 обращения» в чате и «3 запроса» в ленте читались бы как
 * разные метрики.
 */
export function formatKbUsageSummaryLine(totals: Pick<KbUsageTotals, 'queries' | 'documents' | 'estimatedTokens'>): string {
  return `БЗ: ${totals.queries} обращений, ${totals.documents} разделов, ≈${totals.estimatedTokens} токенов`
}

/**
 * Политика «БЗ в первую очередь» для системного промпта CLI. Формулировка —
 * приоритет, а не справка: сначала поиск по базе знаний, затем раздел целиком, и
 * только потом чтение кода. Источник истины при расхождении — код
 * (см. docs/kb/kb-workflow.md).
 *
 * Два варианта одного текста: в `auto` блок контекста уже вставлен в промпт, в
 * `manual` инструмент — единственный путь модели к базе знаний.
 *
 * Живёт в shared, а не на сервере: аргументы CLI собирает исполнитель
 * (`apps/llm-runner`), а промпт хода — сервер.
 */
export function kbToolHint(mode: 'auto' | 'manual'): string {
  const common =
    `База знаний проекта — в первую очередь. Прежде чем читать код, найди тему: ` +
    `mcp__kb__search по задаче, затем mcp__kb__document на найденный раздел ` +
    `(mcp__kb__topics — оглавление). Так дешевле, чем исследовать файлы заново. ` +
    `При расхождении базы знаний и кода источник истины — код: правь и то, и другое.`
  return mode === 'manual'
    ? `${common}\n\nАвтоматический контекст базы знаний для этого разговора выключен ` +
        `(режим «по запросу модели»): инструменты mcp__kb__* — единственный путь к ней.`
    : `${common}\n\nБлок «Контекст базы знаний voiceAIChat» ниже добавлен автоматически ` +
        `по теме запроса — он не полный, за подробностями иди инструментами.`
}
