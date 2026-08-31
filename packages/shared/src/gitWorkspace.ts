// Работа с git в рабочей копии задачи или сессии: типы контракта и чистые разборщики
// вывода git. Ни DOM, ни сети, ни процессов — всё тестируется без моков.
//
// Почему рабочая копия, а не «папка проекта»: смотреть код нужно там, где только что
// работала модель — в `ci_workspaces` задачи или в workdir чата. Плюс незакоммиченные
// правки в этой папке ломают следующий CI-ран (он требует чистого дерева), поэтому
// цикл «посмотреть → поправить → закоммитить → запушить» обязан быть целиком в UI.
//
// Клиент никогда не присылает путь: он присылает id рабочей копии, а путь и машину
// сервер достаёт из своих таблиц. Отсюда `GitWorkspaceId` — не путь, а ссылка.

/** Вид рабочей копии: чем она занята и что в ней можно делать. */
export type GitWorkspaceKind = 'task-workspace' | 'merge-clone' | 'chat-workspace' | 'project-worktree'

/**
 * Почему панель не может работать. Показывается объяснением, а не пустым экраном:
 * «нет изменений» и «каталог снесён cleanup-шагом» — совершенно разные новости.
 */
export type GitWorkspaceProblem =
  | 'workspace_not_found'
  | 'machine_missing'
  | 'machine_offline'
  | 'path_missing'
  | 'not_a_repository'
  | 'workspace_released'
  | 'workspace_busy'

/** Кто и чем занял каталог: пока ран идёт, писать в папку нельзя. */
export interface GitWorkspaceBusy {
  kind: 'ci' | 'merge'
  runId: string
  status: string
}

/** Рабочая копия, с которой работает панель. Путь и машину заполняет только сервер. */
export interface GitWorkspaceRef {
  /** `ws:<ciWorkspaceId>` | `repo:<taskRepositoryId>` | `chat:<conversationId>` | `project:<agentId>` */
  id: string
  kind: GitWorkspaceKind
  projectId: string
  taskId: string | null
  taskTitle: string | null
  /** Номер задачи на доске (`Task.seq`) — подпись «#42» в списке рабочих копий. */
  taskSeq: number | null
  conversationId: string | null
  agentId: string
  machineName: string | null
  path: string
  /** Ветка и SHA, которых мы ждём по данным БД — сверяются с фактическими. */
  expectedBranch: string | null
  expectedSha: string | null
  /** Ветка уже отправлена в origin (`ci_workspaces.pushed`). */
  pushed: boolean | null
  online: boolean
  /**
   * Запись разрешена: полномочие `repository:write`, режим шаринга машины и её
   * политика — всё сразу. UI выключает кнопки по этому флагу, а не угадывает роль:
   * иначе тестировщик видел бы активную кнопку и узнавал об отказе из тоста.
   */
  writable: boolean
  /** Почему запись запрещена — текст для подписи выключенной кнопки. */
  readOnlyReason: string | null
  busy: GitWorkspaceBusy | null
  released: boolean
}

/** Состояние файла в рабочей копии — из `git status --porcelain`. */
export type GitChangeState = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict' | 'typechange'

export interface GitFileChange {
  path: string
  /** Прежний путь при переименовании, иначе null. */
  oldPath: string | null
  state: GitChangeState
  /** Изменение уже в индексе (левая буква XY). */
  staged: boolean
  /** Изменение есть в рабочем дереве (правая буква XY). */
  worktree: boolean
}

export interface GitCommitInfo {
  sha: string
  subject: string
  author: string
  /** Секунды epoch, как отдаёт `%at`. */
  at: number
}

export interface GitWorkspaceStatus {
  ref: GitWorkspaceRef | null
  problem: GitWorkspaceProblem | null
  /** Текст ошибки git или пояснение к `problem` — для «Подробнее» в UI. */
  detail: string | null
  /** HTTPS-origin проекта: по нему панель проверяет credential машины. */
  gitUrl: string | null
  /** База сравнения проекта (`ciBaseBranch`), по умолчанию `main`. */
  baseBranch: string
  /** null — detached HEAD. */
  branch: string | null
  detached: boolean
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  changes: GitFileChange[]
  changesTruncated: boolean
  /** Коммиты сверх `origin/<baseBranch>` — «что уже сделано в этой ветке». */
  commitsAhead: GitCommitInfo[]
}

export interface GitBranchInfo {
  /** Короткое имя: `feature/x` для локальной, `origin/feature/x` для удалённой. */
  name: string
  remote: boolean
  sha: string
  upstream: string | null
  ahead: number
  behind: number
  lastCommitAt: number | null
  subject: string | null
}

export interface GitBranchList {
  current: string | null
  branches: GitBranchInfo[]
  /** Когда последний раз обновляли из origin (кнопка «Обновить»), иначе null. */
  fetchedAt: number | null
}

export interface GitTreeEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
  size: number | null
}

export interface GitTreeListing {
  /** Ревизия, из которой читали дерево (`HEAD` по умолчанию). */
  ref: string
  dir: string
  entries: GitTreeEntry[]
}

export interface GitFileContent {
  path: string
  /** null — рабочая копия (не ревизия). */
  ref: string | null
  content: string
  size: number
  /** Файл больше лимита: содержимое не читали. */
  truncated: boolean
  binary: boolean
}

/** Две версии одного файла для side-by-side сравнения. */
export interface GitFileDiff {
  path: string
  oldPath: string | null
  state: GitChangeState
  /** Слева: содержимое в ревизии сравнения; null для новых файлов. */
  original: GitFileContent | null
  /** Справа: рабочая копия; null для удалённых. */
  modified: GitFileContent | null
}

export interface GitSaveFileResult {
  file: GitFileContent
  status: GitWorkspaceStatus
}

export interface GitCheckoutResult {
  status: GitWorkspaceStatus
  /** Ветку пришлось создать локально из origin. */
  createdLocal: boolean
}

export interface GitCommitResult {
  status: GitWorkspaceStatus
  sha: string
  /** Сколько файлов попало в коммит. */
  staged: number
}

export interface GitPushResult {
  status: GitWorkspaceStatus
  branch: string
  sha: string
}

/** Подтягивание изменений origin в рабочую копию. */
export interface GitPullResult {
  status: GitWorkspaceStatus
  /** Режим, которым свели истории. */
  mode: GitPullMode
  /** Сколько коммитов приехало из origin. */
  pulled: number
}

export type GitPullMode = 'rebase' | 'merge'

/** Отброшенные правки: сколько путей вернули к HEAD и сколько удалили как неотслеживаемые. */
export interface GitDiscardResult {
  status: GitWorkspaceStatus
  reverted: number
  removed: number
}

/**
 * Лимит на одну сторону сравнения. Вывод exec машины ограничен 200 КБ
 * (`OUTPUT_CAP_BYTES` реестра), поэтому просить у git больше бессмысленно: ответ
 * обрежется молча, и diff покажет неправду.
 */
export const GIT_TEXT_MAX_BYTES = 192 * 1024
/** Больше пятисот изменённых файлов — это не «посмотреть правки модели», а мусор в дереве. */
export const GIT_MAX_CHANGES = 500
/** Сколько коммитов сверх базы показываем в статусе. */
export const GIT_MAX_COMMITS_AHEAD = 20

/** Ветки, в которые панель не пушит: туда попадают только через merge-ран и релизы. */
export function isProtectedGitBranch(name: string): boolean {
  const value = name.trim()
  return value === 'main' || value === 'master' || value.startsWith('release/')
}

/**
 * Имя ветки для команды. Строгий allowlist, а не «всё, что примет git»: имя уходит в
 * shell (пусть и в кавычках), и любое расширение набора символов — это разговор о том,
 * почему оно безопасно. Форма списана с проверки refspec у git-доступа проекта.
 */
export function isValidGitBranchName(name: string): boolean {
  if (!name || name.length > 200) return false
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return false
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/')) return false
  if (name.includes('..') || name.includes('//')) return false
  if (name.endsWith('.lock') || name.endsWith('.')) return false
  return true
}

/** Ревизия для чтения: ветка, тег, SHA, `HEAD~1`, `origin/main`. */
export function isValidGitRef(ref: string): boolean {
  if (!ref || ref.length > 200) return false
  if (!/^[A-Za-z0-9._/~^-]+$/.test(ref)) return false
  if (ref.startsWith('-') || ref.includes('..')) return false
  return true
}

/**
 * Путь внутри репозитория. Абсолютные пути и `..` не пропускаем: иначе панель станет
 * вторым файловым проводником, но без его политики каталогов.
 */
export function isSafeRepoRelativePath(path: string): boolean {
  if (!path || path.length > 400) return false
  if (/[\0\n\r]/.test(path)) return false
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return false
  if (path.includes('\\')) return false
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false
  if (parts[0] === '.git') return false
  return true
}

/** Сообщение коммита: непустое и не безразмерное. null — сообщение не годится. */
export function normalizeCommitMessage(text: string): string | null {
  const value = text.replace(/\r\n/g, '\n').trim()
  if (!value || value.length > 4000) return null
  return value
}

/** Подпись состояния файла для человека. */
export function gitChangeLabel(state: GitChangeState): string {
  switch (state) {
    case 'modified': return 'изменён'
    case 'added': return 'добавлен'
    case 'deleted': return 'удалён'
    case 'renamed': return 'переименован'
    case 'untracked': return 'новый'
    case 'conflict': return 'конфликт'
    case 'typechange': return 'смена типа'
  }
}

/** Двухбуквенный маркер состояния для плотного списка. */
export function gitChangeShort(state: GitChangeState): string {
  switch (state) {
    case 'modified': return 'M'
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'untracked': return '??'
    case 'conflict': return 'U'
    case 'typechange': return 'T'
  }
}

/** Человеческий текст проблемы: он же попадает в `EmptyState`/`ErrorState`. */
export function gitProblemMessage(problem: GitWorkspaceProblem): string {
  switch (problem) {
    case 'workspace_not_found': return 'Рабочая копия не найдена'
    case 'machine_missing': return 'Машина рабочей копии недоступна в этом проекте'
    case 'machine_offline': return 'Машина не в сети'
    case 'path_missing': return 'У рабочей копии не задан каталог'
    case 'not_a_repository': return 'В каталоге нет git-репозитория'
    case 'workspace_released': return 'Рабочая копия удалена cleanup-шагом рана'
    case 'workspace_busy': return 'Каталог занят активным раном'
  }
}

/** Разделитель секций составного вывода. Без `>`: он запрещён политикой машины без allowWrite. */
export const GIT_SECTION_MARK = '==VC:'
// Цифры в имени секции обязательны: `status_b64`, `tree_b64`, `content_b64`.
const SECTION_RE = /^==VC:([a-z0-9_]+)==$/

/**
 * Разбор одного вывода на именованные секции. Один exec вместо восьми — это не
 * оптимизация, а требование: каждый вызов идёт до машины пользователя и обратно.
 * Строки вне секций (stderr git вклинивается в тот же поток) отбрасываются.
 */
export function splitGitSections(output: string): Record<string, string> {
  const sections: Record<string, string> = {}
  let current: string | null = null
  let buffer: string[] = []
  const flush = (): void => {
    if (current) sections[current] = buffer.join('\n')
    buffer = []
  }
  for (const line of output.split('\n')) {
    const match = SECTION_RE.exec(line.trim())
    if (match) {
      flush()
      current = match[1]
      continue
    }
    if (current) buffer.push(line)
  }
  flush()
  return sections
}

/** Строка `1\t0` из `rev-list --left-right --count HEAD...@{upstream}`. */
export function parseAheadBehind(output: string): { ahead: number; behind: number } {
  const line = output.split('\n').map((value) => value.trim()).find((value) => /^\d+\s+\d+$/.test(value))
  if (!line) return { ahead: 0, behind: 0 }
  const [ahead, behind] = line.split(/\s+/).map((value) => Number(value))
  return { ahead: ahead ?? 0, behind: behind ?? 0 }
}

/** `[ahead 1, behind 2]` из `%(upstream:track)` или из заголовка `## br...up [..]`. */
export function parseTrackSuffix(text: string): { ahead: number; behind: number } {
  const ahead = /ahead (\d+)/.exec(text)
  const behind = /behind (\d+)/.exec(text)
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 }
}

export interface GitStatusHead {
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
}

export interface GitStatusPorcelain {
  head: GitStatusHead
  changes: GitFileChange[]
  truncated: boolean
}

/** Состояние файла по паре букв XY из `--porcelain=v1`. */
function changeState(x: string, y: string): GitChangeState {
  if (x === '?' && y === '?') return 'untracked'
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict'
  if (x === 'R' || y === 'R') return 'renamed'
  if (x === 'A' || y === 'A') return 'added'
  if (x === 'D' || y === 'D') return 'deleted'
  if (x === 'T' || y === 'T') return 'typechange'
  return 'modified'
}

/**
 * Разбор `git status --porcelain=v1 -z -b`. Именно `-z`, а не построчный вывод: с ним
 * git не экранирует пути в C-кавычки, и разборщику не приходится знать про `"\320\272"`.
 * Форма записи: `XY <путь>\0`, а у переименования — `R  <новый>\0<старый>\0`
 * (проверено на живом репозитории: сначала новый путь, потом старый).
 */
export function parseGitStatusPorcelain(output: string, maxChanges: number = GIT_MAX_CHANGES): GitStatusPorcelain {
  const head: GitStatusHead = { branch: null, detached: false, upstream: null, ahead: 0, behind: 0 }
  const changes: GitFileChange[] = []
  let truncated = false
  const records = output.split('\0')
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (!record) continue
    if (record.startsWith('## ')) {
      const value = record.slice(3).trim()
      // `## HEAD (no branch)` — detached; `## br...origin/br [ahead 1]` — с upstream.
      if (value.startsWith('HEAD (no branch)')) {
        head.detached = true
        continue
      }
      const track = /\s\[(.+)\]$/.exec(value)
      if (track) Object.assign(head, parseTrackSuffix(track[1]))
      const withoutTrack = track ? value.slice(0, track.index) : value
      const [branch, upstream] = withoutTrack.split('...')
      head.branch = branch || null
      head.upstream = upstream || null
      continue
    }
    if (record.length < 4) continue
    const x = record[0], y = record[1]
    const path = record.slice(3)
    const state = changeState(x, y)
    // У переименования следом идёт вторая запись — прежний путь.
    const oldPath = state === 'renamed' ? records[i += 1] ?? null : null
    if (changes.length >= maxChanges) {
      truncated = true
      continue
    }
    changes.push({
      path,
      oldPath: oldPath || null,
      state,
      staged: x !== ' ' && x !== '?',
      worktree: y !== ' ' && y !== '?'
    })
  }
  return { head, changes, truncated }
}

/**
 * Разбор `for-each-ref --format='%(refname:short)\t%(objectname)\t%(upstream:short)\t%(committerdate:unix)\t%(upstream:track)\t%(contents:subject)'`.
 * Одна команда на локальные и удалённые ветки — у `git branch -vv` тот же смысл, но
 * его вывод приходится угадывать по пробелам и скобкам.
 */
export function parseGitRefs(output: string, remotePrefix: string = 'origin/'): GitBranchInfo[] {
  const branches: GitBranchInfo[] = []
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const [name, sha, upstream, date, track, ...rest] = line.split('\t')
    if (!name || !sha) continue
    if (name === `${remotePrefix}HEAD`) continue
    const { ahead, behind } = parseTrackSuffix(track ?? '')
    const at = Number(date)
    branches.push({
      name,
      remote: name.startsWith(remotePrefix),
      sha,
      upstream: upstream || null,
      ahead,
      behind,
      lastCommitAt: Number.isFinite(at) && at > 0 ? at : null,
      subject: rest.length ? rest.join('\t') : null
    })
  }
  return branches
}

/**
 * Разбор `git ls-tree -l <ref> [-- <dir>/]`: `<mode> <type> <sha> <size>\t<path>`.
 * Дерево читается по одному уровню, а не целиком (`ls-files` на монорепо не влезает
 * в 200 КБ вывода exec).
 */
export function parseGitLsTree(output: string, dir: string = ''): GitTreeEntry[] {
  const entries: GitTreeEntry[] = []
  const prefix = dir ? `${dir.replace(/\/+$/, '')}/` : ''
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const meta = line.slice(0, tab).split(/\s+/)
    const path = line.slice(tab + 1)
    const type = meta[1]
    if (type !== 'blob' && type !== 'tree') continue
    const size = Number(meta[3])
    const name = path.startsWith(prefix) ? path.slice(prefix.length) : path
    if (!name || name.includes('/')) continue
    entries.push({
      name,
      path,
      kind: type === 'tree' ? 'dir' : 'file',
      size: type === 'blob' && Number.isFinite(size) ? size : null
    })
  }
  return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
}

/** Разбор `git log --format='%H\t%an\t%at\t%s'`. */
export function parseGitLog(output: string): GitCommitInfo[] {
  const commits: GitCommitInfo[] = []
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const [sha, author, at, ...rest] = line.split('\t')
    if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) continue
    const seconds = Number(at)
    commits.push({
      sha,
      author: author ?? '',
      at: Number.isFinite(seconds) ? seconds : 0,
      subject: rest.join('\t')
    })
  }
  return commits
}

/**
 * Ссылка на рабочую копию: разобранная форма `GitWorkspaceRef.id`. Имена вариантов
 * намеренно отличаются от `GitWorkspaceKind` — это разные вещи: здесь «в какой
 * таблице искать», там «чем эта копия является».
 */
export type GitWorkspaceIdRef =
  | { kind: 'ci-workspace'; ciWorkspaceId: string }
  | { kind: 'task-repository'; taskRepositoryId: string }
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'project-machine'; agentId: string }

/**
 * Разбор id рабочей копии. Формы «путь на машине» здесь нет намеренно: панель не
 * должна уметь открыть произвольный каталог на чужой машине — это отдельная дыра, а
 * не удобство. Если такое понадобится, правильный путь — короткоживущий токен цели,
 * выданный сервером после проверки политики каталогов.
 */
export function parseGitWorkspaceId(id: string): GitWorkspaceIdRef | null {
  const at = id.indexOf(':')
  if (at <= 0) return null
  const prefix = id.slice(0, at)
  const value = id.slice(at + 1)
  if (!value) return null
  if (prefix === 'ws') return { kind: 'ci-workspace', ciWorkspaceId: value }
  if (prefix === 'repo') return { kind: 'task-repository', taskRepositoryId: value }
  if (prefix === 'chat') return { kind: 'conversation', conversationId: value }
  if (prefix === 'project') return { kind: 'project-machine', agentId: value }
  return null
}

export function buildGitWorkspaceId(ref: GitWorkspaceIdRef): string {
  if (ref.kind === 'ci-workspace') return `ws:${ref.ciWorkspaceId}`
  if (ref.kind === 'task-repository') return `repo:${ref.taskRepositoryId}`
  if (ref.kind === 'conversation') return `chat:${ref.conversationId}`
  return `project:${ref.agentId}`
}
