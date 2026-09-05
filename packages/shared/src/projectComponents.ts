// Компоненты реального проекта в Make: список сториз рабочей копии, сессия Storybook
// на машине и быстрый тикет из правки. Чистые типы и разборщики — ни сети, ни DOM.
//
// Почему источник кода — рабочая копия, а не песочница Make: компонент проекта живёт
// среди своих зависимостей, алиасов и стилей, и вне репозитория он не собирается.
// Поэтому Make открывает файлы через тот же `GitWorkspaceService`, что и панель «Код»,
// а показывает их настоящим Storybook проекта, запущенным на машине.
//
// Почему список стори берётся из живого Storybook, когда он поднят: `index.json`
// знает настоящие `storyId` (они же — адрес кадра `iframe.html?id=…`), а разбор
// файлов даёт лишь имена экспортов и обходится в N запросов к машине.

/** Порт по умолчанию для `storybook dev` — тот же, что в наших скриптах пакетов. */
export const PROJECT_STORYBOOK_DEFAULT_PORT = 6006

/** Команда по умолчанию: запускается в каталоге рабочей копии. */
export const PROJECT_STORYBOOK_DEFAULT_COMMAND = 'npm run storybook --'

/**
 * Состояние сессии. `starting` — процесс живой, но `/index.json` ещё не ответил:
 * первая сборка Vite занимает десятки секунд, и «пусто» тут значит «ждём», а не «сломалось».
 */
export type ProjectStorybookState = 'stopped' | 'starting' | 'running' | 'failed'

export interface ProjectStoryEntry {
  /** Адрес стори в Storybook (`iframe.html?id=…`). */
  id: string
  /** Отображаемое имя стори («Primary», «С ошибкой»). */
  name: string
}

export interface ProjectComponentEntry {
  /** Путь файла сториз в репозитории; пуст, если компонент известен только живому Storybook. */
  path: string
  /** Заголовок из CSF (`title`) или имя файла. */
  title: string
  stories: ProjectStoryEntry[]
}

export interface ProjectComponentsListing {
  workspaceId: string
  /** `storybook` — из живого `/index.json`, `files` — из `git ls-files` (id стори вычислены). */
  source: 'storybook' | 'files'
  components: ProjectComponentEntry[]
  /** Список обрезан лимитом вывода машины — показываем это, а не молча теряем компоненты. */
  truncated: boolean
}

export interface ProjectStorybookSession {
  workspaceId: string
  agentId: string
  /** Имя машины для подписи; пусто, если машина уже не в списке проекта. */
  machineName: string
  state: ProjectStorybookState
  port: number
  command: string
  startedAt: number | null
  readyAt: number | null
  /** Причина отказа для `failed` — текст показывается пользователю как есть. */
  error: string | null
  /** Хвост вывода процесса без ANSI: без него «не запустилось» невозможно объяснить. */
  log: string
  /**
   * Storybook уже работал на этом порту, когда панель к нему подключилась: его
   * запустили руками или он пережил перезапуск сервера. Такой процесс мы не убиваем —
   * он не наш, и «Остановить» для него честно недоступна.
   */
  adopted: boolean
}

export type ProjectStorybookAction = 'start' | 'stop' | 'restart'

export interface ProjectComponentTicketRequest {
  workspaceId: string
  title: string
  description?: string
  /** Пути, которые уходят в коммит. Пустой список запрещён — коммитить всё подряд опасно. */
  paths: string[]
  labels?: string[]
}

export interface ProjectComponentTicketResult {
  taskId: string
  taskNumber: number
  branch: string
  commitSha: string
  /** Колонка, в которую встала карточка (семантика `awaiting_merge`). */
  columnId: string
  /** Готова ли карточка к слиянию прямо сейчас — merge-ран потребует ещё и своих проверок. */
  readyToMerge: boolean
}

const STORY_ID_SEPARATOR = '--'

/**
 * Идентификатор стори по правилам `@storybook/csf` (`toId`): и заголовок, и имя
 * приводятся к нижнему регистру, пунктуация схлопывается в дефисы. Повторяем алгоритм
 * у себя, чтобы не тащить рантайм Storybook в общий пакет.
 */
export function storybookSanitize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ ’–—―′¿'`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
}

/** `Chat/VoiceBar` + `Recording` → `chat-voicebar--recording`. */
export function storybookStoryId(title: string, exportName: string): string {
  return `${storybookSanitize(title)}${STORY_ID_SEPARATOR}${storybookSanitize(exportName)}`
}

/**
 * Человеческое имя стори из имени экспорта: `PrimaryButton` → `Primary Button`
 * (так же поступает сам Storybook, когда у стори нет явного `name`).
 */
export function storybookStoryName(exportName: string): string {
  return exportName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Виртуальный хост машины: тот же алиас, что понимает прокси `/api/preview`. */
export function machineOrigin(agentId: string, port: number): string {
  return `http://${agentId}.machine.internal:${port}`
}

/**
 * Адрес кадра одной стори. Открываем `iframe.html`, а не менеджер Storybook: менеджер
 * тянет свой UI и вложенный iframe вторым уровнем через тот же прокси, а нам нужен
 * только компонент.
 */
export function projectStorybookFrameUrl(agentId: string, port: number, storyId: string): string {
  const target = `${machineOrigin(agentId, port)}/iframe.html`
  // `id` и `viewMode` идут в НАШ query, а не в адрес цели: Storybook выбирает стори на
  // клиенте, читая `location.search` уже отданного документа, а там — адрес прокси.
  // С параметрами внутри цели кадр показывал «No Preview» (проверено на стенде).
  return `/api/preview?url=${encodeURIComponent(target)}&viewMode=story&id=${encodeURIComponent(storyId)}`
}

/** Признак файла сториз в репозитории (CSF любого из наших расширений). */
export function isProjectStoryPath(path: string): boolean {
  return /\.stories\.(t|j)sx?$/i.test(path)
}

interface StorybookIndexEntry {
  id?: unknown
  title?: unknown
  name?: unknown
  type?: unknown
  importPath?: unknown
}

/**
 * Разбор `/index.json` живого Storybook (v8: `{ v: 5, entries: {…} }`; более старый
 * формат `stories` тоже принимаем). Записи `docs` пропускаем — кадр для них другой.
 */
export function parseStorybookIndex(raw: unknown): ProjectComponentEntry[] {
  const root = raw as { entries?: Record<string, StorybookIndexEntry>; stories?: Record<string, StorybookIndexEntry> } | null
  const entries = root?.entries ?? root?.stories
  if (!entries || typeof entries !== 'object') return []
  const byTitle = new Map<string, ProjectComponentEntry>()
  for (const entry of Object.values(entries)) {
    if (!entry || typeof entry !== 'object') continue
    if (typeof entry.type === 'string' && entry.type !== 'story') continue
    const id = typeof entry.id === 'string' ? entry.id : ''
    const title = typeof entry.title === 'string' ? entry.title : ''
    if (!id || !title) continue
    const name = typeof entry.name === 'string' && entry.name ? entry.name : id.split(STORY_ID_SEPARATOR).pop() ?? id
    const path = typeof entry.importPath === 'string' ? entry.importPath.replace(/^\.\//, '') : ''
    const found = byTitle.get(title)
    if (found) {
      if (!found.stories.some((story) => story.id === id)) found.stories.push({ id, name })
      if (!found.path && path) found.path = path
      continue
    }
    byTitle.set(title, { path, title, stories: [{ id, name }] })
  }
  return [...byTitle.values()].sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}
