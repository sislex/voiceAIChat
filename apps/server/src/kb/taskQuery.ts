// Подготовка запроса к базе знаний: проза отдельно, код отдельно.
//
// Зачем разделять. Лексический поиск считает частоты слов, и код в описании
// задачи ему только мешает: `cat -n`, `python3 - <<PY`, имена колонок и пути не
// складываются в тему. Прежняя попытка это учесть работала наоборот: если в
// описании были бэктики, из него брали ТОЛЬКО их содержимое, а прозу
// выбрасывали. На технических задачах (CHAT-54/68/70) от описания оставался
// набор идентификаторов вроде `read`/`grep`/`edit`/`${режим}`, тема пропадала, и
// авто-инъекция молчала ровно там, где знание кодовой базы нужнее всего.
//
// Поэтому дорожек две. Проза (заголовок + текст без блоков кода) идёт в BM25 как
// раньше. Пути и имена символов собираются отдельно и ищутся своим запросом — по
// `areas` (они же `related_files` разделов) и `symbols` документов; эту дорожку
// зовёт kb/autoContext.ts, когда лексическая не дала ничего.

/** Запрос к БЗ, разобранный на прозу и код. */
export interface KbQuery {
  /** Лексическая дорожка: заголовок и текст задачи без кода. */
  text: string
  /** Пути и имена файлов из текста — дорожка по `areas` разделов. */
  paths: string[]
  /** Имена символов из кода — дорожка по `symbols` документов. */
  symbols: string[]
}

/**
 * Кап на длину прозы: описание и критерии приёмки бывают на несколько экранов, а
 * поиску нужна тема, а не весь текст. Заголовок идёт первым и обрезке не
 * подлежит — он самая плотная формулировка темы, какая у задачи есть.
 */
export const KB_QUERY_CHARS = 1200

/** Больше сигналов одной дорожке не помогает: хвост списка только размывает BM25. */
const MAX_PATHS = 10
const MAX_SYMBOLS = 12

const FENCED = /```[\s\S]*?(?:```|$)/g
const INLINE = /`([^`\n]+)`/g
/** Путь: сегменты через `/` либо имя файла с известным расширением. */
const PATH = /(?:[\w.@-]+\/)+[\w.@-]+|[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|sql|css|scss|sh|ya?ml|toml)\b/g
/** Идентификатор: camelCase, PascalCase или snake_case — обычное слово не берём. */
const SYMBOL = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g

/** Хвост вида `:414` или `:74–93` — координата в файле, а не часть пути. */
function cleanPath(value: string): string {
  return value
    .replace(/[:#]\d+(?:[-–—]\d+)?$/, '')
    .replace(/^\.\//, '')
    .replace(/[.,;:)\]}]+$/, '')
    .replace(/\/+$/, '')
}

/**
 * Похоже ли на путь в репозитории. Проверка нарочно широкая: ложный путь
 * (`read/grep/edit`, `Claude/Codex`) не совпадёт ни с одним `areas` и просто
 * ничего не добавит, а вот потерянный путь стоит целой инъекции.
 */
function looksLikePath(value: string): boolean {
  if (!value || value.includes('://') || value.startsWith('-')) return false
  return value.includes('/') ? !value.startsWith('/') && !value.endsWith('/') : /\.[a-z]{2,4}$/i.test(value)
}

/** Идентификатором считаем только то, что человек не напишет в прозе случайно. */
function looksLikeSymbol(value: string): boolean {
  if (value.length < 4 || value.length > 60) return false
  if (value.includes('.')) return value.split('.').every((part) => part.length > 1)
  return /[a-z]/.test(value) && (/[a-z][A-Z]/.test(value) || value.includes('_') || /^[A-Z]/.test(value))
}

function unique(values: string[], limit: number): string[] {
  return [...new Set(values)].slice(0, limit)
}

/**
 * Разобрать произвольный текст (описание задачи, реплику чата) на дорожки.
 * Пути берутся из всего текста: в описаниях их пишут и без бэктиков. Символы —
 * только из кодовых участков, иначе в список уезжают слова прозы с заглавной.
 */
export function prepareKbQuery(raw: string, headline = ''): KbQuery {
  const body = raw.replace(FENCED, ' ')
  const all = `${headline}\n${raw}`
  const code = [
    ...[...raw.matchAll(FENCED)].map((m) => m[0]),
    ...[...body.matchAll(INLINE)].map((m) => m[1])
  ].join('\n')
  const paths = unique(
    [...all.matchAll(PATH)].map((m) => cleanPath(m[0])).filter(looksLikePath),
    MAX_PATHS
  )
  const symbols = unique(
    [...code.matchAll(SYMBOL)].map((m) => m[0]).filter(looksLikeSymbol).filter((s) => !paths.includes(s)),
    MAX_SYMBOLS
  )
  // Бэктики снимаем, а содержимое оставляем: `sectionsHit` — часть фразы, и в
  // прозе оно работает как обычное слово. Выбрасываются только блоки кода.
  const prose = body.replace(/`/g, ' ').replace(/[^\S\n]+/g, ' ').trim()
  const text = [headline.trim(), prose].filter(Boolean).join('\n').slice(0, KB_QUERY_CHARS).trim()
  return { text, paths, symbols }
}

/** Запрос авто-контекста по задаче CI-рана. */
export function kbTaskQuery(task: {
  title: string
  description?: string | null
  acceptanceCriteria?: string | null
}): KbQuery {
  const body = [task.description, task.acceptanceCriteria].filter(Boolean).join('\n')
  return prepareKbQuery(body, task.title)
}

/** Запрос кодовой дорожки: пути и символы одной строкой (её ждёт BM25 с бустами). */
export function kbCodeQuery(query: KbQuery): string {
  return [...query.paths, ...query.symbols].join(' ').slice(0, KB_QUERY_CHARS)
}

/**
 * Задет ли `area` документа один из упомянутых в задаче путей. Сравнение идёт в
 * обе стороны: в задаче обычно файл (`apps/server/src/ci/kbHit.ts`), а в `areas`
 * — каталог (`apps/server/src/ci`), но бывает и наоборот.
 */
export function areaTouchesPath(area: string, path: string): boolean {
  const a = cleanPath(area.toLowerCase()).replace(/\*+.*$/, '').replace(/\/+$/, '')
  const p = cleanPath(path.toLowerCase())
  if (!a || !p) return false
  return a === p || p.startsWith(`${a}/`) || a.startsWith(`${p}/`) || a.endsWith(`/${p}`) || p.endsWith(`/${a}`)
}
