// Актуализация базы знаний по изменениям кода: общий код шага CI-рана
// «Актуализировать базу знаний» (ci/modelHooks.ts) и режима «по изменениям с
// коммита <sha>» операции «Исследовать проект» (kb/research.ts).
//
// Идея: база знаний устаревает не потому, что её некому писать, а потому что
// запись отвязана от правки кода. Здесь она привязана: на вход идёт диф рабочей
// копии к базовой ветке, на выход — правки ровно тех статей, которых изменение
// касается. Адресатов записи два, и они разные по механике:
//   * файловые темы `docs/kb/*.md` — модель правит их сама в рабочей копии
//     (у неё есть remote-bash), там же ставит свежесть и перегенерирует индекс;
//   * статьи раздела проекта (`scope='project'`) — их пишет сервер через
//     `db.saveKbDocument`, как в KbResearchManager: раздел и владелец статьи не
//     должны зависеть от того, что модель себе придумала.

import type { KbDocumentKind } from '@voicechat/shared'
import type { KbStoredDocument } from '../db/database.js'
import { MAX_BODY_CHARS, MAX_DOCUMENTS, type ResearchDocument } from './modelDocs.js'

/** Шаг длинный (модель читает диф и правит файлы), но ран из-за него не ждёт вечно. */
export const KB_UPDATE_TIMEOUT_MS = 20 * 60 * 1000
/** Кап патча, который уезжает в промпт (в скрипте — свой `head -c`). */
export const MAX_PATCH_CHARS = 100_000
/** Сколько статей раздела проекта показываем модели и принимаем обратно. */
export const MAX_AFFECTED_DOCS = 8

/** Диф рабочей копии к базовой ветке в разобранном виде. */
export interface KbCodeChanges {
  /** Пути изменённых файлов (включая новые неотслеживаемые). */
  files: string[]
  /** `git diff --stat`. */
  stat: string
  /** Патч (уже обрезанный). */
  patch: string
  /** Репозиторий не найден или базовой ветки нет — диф собрать не удалось. */
  unavailable: boolean
}

export const EMPTY_CHANGES: KbCodeChanges = { files: [], stat: '', patch: '', unavailable: true }

/**
 * Проверка корня перед ходом KB. `workspacePath` в контексте модели уже указывает
 * на клон, а не на каталог-контейнер команд: проверяем именно его, чтобы в MCP
 * не ушёл несуществующий вложенный путь и пустой ответ модели не стал успехом.
 */
export const KB_REPO_ROOT_CHECK_SCRIPT = 'git rev-parse --show-toplevel'

/**
 * Скрипт сбора дифа. Значения берёт из окружения шага (`SLUG`, `BASE_BRANCH`,
 * необязательный `KB_BASE_REF`) — в текст скрипта пользовательские данные не
 * конкатенируются. Диф считается от базы к рабочему дереву, а не к HEAD:
 * шаг идёт ДО «Закоммитить работу в ветку задачи», и часть правок модели может
 * быть ещё незакоммичена. `package-lock.json` и генерируемый индекс базы из
 * патча исключены — это шум, который съедает кап.
 */
export const KB_DIFF_SCRIPT = `set -u
dir="\${SLUG:-}"
if [ -n "$dir" ] && [ -d "$dir/.git" ]; then cd -- "$dir"; fi
if ! git rev-parse --git-dir >/dev/null 2>&1; then echo "===NOGIT==="; exit 0; fi
base="\${KB_BASE_REF:-}"
if [ -z "$base" ]; then base="origin/\${BASE_BRANCH:-main}"; fi
git rev-parse --verify -q "$base" >/dev/null 2>&1 || base="\${BASE_BRANCH:-main}"
git rev-parse --verify -q "$base" >/dev/null 2>&1 || { echo "===NOBASE==="; exit 0; }
echo "===FILES==="
{ git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u
echo "===STAT==="
git diff --stat "$base" | tail -n 80
echo "===PATCH==="
{ git diff "$base" -- . ':(exclude)*package-lock.json' ':(exclude)docs/kb/README.md' || true; } | head -c ${MAX_PATCH_CHARS}`

/**
 * Короткая повторная проверка после прерванного хода KB. Она намеренно смотрит
 * только на файловые темы: статьи раздела проекта сервер может сохранить лишь
 * из финального JSON-ответа модели, а изменения `docs/kb` уже находятся в
 * рабочей копии и должны дойти до следующего шага коммита.
 */
export const KB_FILE_TOPICS_SCRIPT = `set -u
dir="\${SLUG:-}"
if [ -n "$dir" ] && [ -d "$dir/.git" ]; then cd -- "$dir"; fi
if ! git rev-parse --git-dir >/dev/null 2>&1; then exit 0; fi
base="\${KB_BASE_REF:-}"
if [ -z "$base" ]; then base="origin/\${BASE_BRANCH:-main}"; fi
git rev-parse --verify -q "$base" >/dev/null 2>&1 || base="\${BASE_BRANCH:-main}"
git rev-parse --verify -q "$base" >/dev/null 2>&1 || exit 0
{ git diff --name-only "$base" -- docs/kb; git ls-files --others --exclude-standard -- docs/kb; } | sort -u`

/** Разбор вывода `KB_DIFF_SCRIPT` по маркерам секций. */
export function parseDiffBundle(raw: string): KbCodeChanges {
  if (!raw.includes('===FILES===')) return { ...EMPTY_CHANGES }
  const section = (from: string, to: string | null): string => {
    const start = raw.indexOf(from)
    if (start < 0) return ''
    const rest = raw.slice(start + from.length)
    const end = to ? rest.indexOf(to) : -1
    return (end < 0 ? rest : rest.slice(0, end)).trim()
  }
  const files = section('===FILES===', '===STAT===')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('==='))
  return {
    files,
    stat: section('===STAT===', '===PATCH==='),
    patch: section('===PATCH===', null).slice(0, MAX_PATCH_CHARS),
    unavailable: false
  }
}

/** Путь без './' и хвостового слэша — сравнивать пути из `areas` и из дифа иначе нельзя. */
function normPath(p: string): string {
  return p.trim().replace(/^\.\//, '').replace(/\/+$/, '')
}

/** Следит ли статья за этим файлом: `areas` — это файл либо каталог над ним. */
export function areaMatchesFile(area: string, file: string): boolean {
  const a = normPath(area)
  const f = normPath(file)
  if (!a || !f) return false
  return a === f || f.startsWith(`${a}/`) || a.startsWith(`${f}/`)
}

/**
 * Статьи, которых изменение касается: пересечение `areas` с путями дифа.
 * Порядок — по числу совпавших файлов (сначала самые задетые), лишние
 * отбрасываем: переписывать всю базу на каждом ране незачем.
 */
export function pickAffectedDocs<T extends { areas: string[] }>(files: string[], docs: T[], limit = MAX_AFFECTED_DOCS): T[] {
  return docs
    .map((doc) => ({ doc, hits: files.filter((f) => doc.areas.some((a) => areaMatchesFile(a, f))).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.doc)
}

/**
 * Один пробел базы знаний для промпта шага: вопрос плюс то, что о нём известно.
 * Источников два, и они дополняют друг друга — модель называет пробел сама
 * (блок `kb-gaps`, тогда есть `answer`), а телеметрия обращений знает вопросы,
 * на которые база не ответила, даже если модель промолчала (тогда есть только
 * `reason`, и ответ шаг ищет в коде рабочей копии).
 */
export interface KbGapForPrompt {
  question: string
  /** Что модель выяснила по коду или по итогам разработки. */
  answer?: string
  /** Куда это писать по мнению модели: тема `docs/kb/*.md` или заголовок статьи. */
  topic?: string
  /** Почему база осталась без ответа (из телеметрии обращений). */
  reason?: string
}

/** Сколько пробелов уходит в промпт: остальное — хвост, который шаг не осилит. */
export const MAX_PROMPT_GAPS = 12

export interface KbUpdatePromptArgs {
  /** Название проекта (для шапки промпта). */
  projectName: string
  /** Каталог рабочей копии на машине. */
  workdir: string
  /** Что делали: заголовок и описание задачи (для CI-шага) либо база сравнения. */
  taskTitle?: string
  taskDescription?: string
  /** С чем сравнивали: базовая ветка или конкретный sha. */
  baseLabel: string
  changes: KbCodeChanges
  /** Статьи раздела проекта, задетые изменением (id возвращается моделью обратно). */
  affected: Array<{ id: string; title: string; areas: string[] }>
  /** Править ли файловые темы `docs/kb/*.md` в рабочей копии (в режиме «только чтение» — нет). */
  editFileTopics: boolean
  /**
   * Пробелы базы знаний этого рана. Диф отвечает на вопрос «что изменилось», но
   * не на «о чём модель спрашивала базу и не получила ответа»: без этого списка
   * найденный в коде ответ пропадает, и следующий ран исследует то же заново.
   */
  gaps?: KbGapForPrompt[]
}

/**
 * Блок пробелов базы знаний. Формулировка держит три требования разом: пробел
 * обязан стать правкой РАЗДЕЛА (а не новой статьёй рядом), факт сначала
 * проверяется по коду (база знаний не место для догадок), а незакрытый пробел
 * честнее оставить незакрытым, чем записать предположение.
 */
function gapsBlock(gaps: KbGapForPrompt[]): string[] {
  if (!gaps.length) return []
  const lines = gaps.slice(0, MAX_PROMPT_GAPS).map((gap) => {
    const parts = [`- Спрашивали базу: ${gap.question}`]
    parts.push(gap.answer ? `выяснено: ${gap.answer}` : `ответа база не дала (${gap.reason ?? 'пусто'}) — найди его в коде`)
    if (gap.topic) parts.push(`куда писать по мнению модели: ${gap.topic}`)
    return parts.join('\n  ')
  })
  return [
    `Пробелы базы знаний в этом ране (${gaps.length}) — закрыть обязательно:`,
    ...lines,
    'Каждый пункт должен превратиться в правку того раздела, где эти сведения искали: сначала сверь факт',
    'с кодом рабочей копии и дифом, потом ДОПОЛНИ существующий раздел (новую статью заводи только если',
    'подходящего раздела нет — двух записей об одном быть не должно). Что по коду не подтвердилось —',
    'не записывай: незакрытый пробел лучше записанной догадки.',
    ''
  ]
}

/**
 * Промпт актуализации. Один текст на оба входа (шаг рана и ручной фолбэк):
 * расходятся они только тем, разрешено ли модели править файлы в рабочей копии.
 */
export function kbUpdatePrompt(args: KbUpdatePromptArgs): string {
  const { changes } = args
  const fileTopics = args.editFileTopics
    ? [
        '',
        '1) Файловые темы репозитория — `docs/kb/*.md`. Правь их прямо в рабочей копии по правилам',
        '`docs/kb/kb-workflow.md`: факты, а не планы; одна тема — один файл; не дублируй код (ссылайся на',
        'файл-источник); пиши абзацами по подтемам. Новая крупная подсистема — новый файл темы и строка в',
        'таблице указателей корневого `AGENTS.md`. После правок обязательно:',
        '- `node scripts/kb.mjs touch <topic>` на каждую тронутую тему (свежесть: дата + sha);',
        '- `npm run kb:log -- <slug>` — короткая запись журнала о том, что изменилось;',
        '- `npm run kb:index` — перегенерировать `docs/kb/README.md`.',
        'НЕ коммить и не пушь: следующий шаг воркфлоу закоммитит правки вместе с кодом.'
      ]
    : ['', '1) Файлы репозитория не меняй — сейчас только чтение.']
  return [
    `Ты ведёшь базу знаний по разработке проекта «${args.projectName}».`,
    `Репозиторий — на этой машине, каталог: ${args.workdir}`,
    args.taskTitle ? `Только что выполнена задача: ${args.taskTitle}` : '',
    args.taskDescription ? `Описание задачи: ${args.taskDescription}` : '',
    '',
    `Задача: записать в базу знаний, что изменилось в коде и как приложение работает теперь, чтобы следующей`,
    `модели хватило базы знаний вместо повторного исследования кода. Сравнение с: ${args.baseLabel}.`,
    '',
    ...(changes.files.length
      ? [
          `Изменённые файлы (${changes.files.length}):`,
          changes.files.slice(0, 200).join('\n'),
          changes.stat ? `\nСводка:\n${changes.stat}` : '',
          changes.patch ? `\nПатч (может быть обрезан):\n${changes.patch}` : ''
        ]
      : changes.unavailable
        ? [
            // Диф заранее не собран (ручной прогон «по изменениям с коммита»):
            // модель собирает его сама тем же bash, которым читает код.
            `Диф заранее не собран — собери его сам: \`git diff --stat ${args.baseLabel}\` и патч по изменённым файлам.`
          ]
        : [
            // Диф собран и пуст: шаг дошёл до модели только из-за пробелов базы
            // знаний — их и надо закрыть, поведение приложения не менялось.
            'Изменений кода в ветке нет: записать нужно только пробелы базы знаний ниже.'
          ]),
    '',
    ...gapsBlock(args.gaps ?? []),
    'Куда писать — два адресата, оба обязательны.',
    ...fileTopics,
    '',
    '2) Статьи раздела «Разработка проекта» в базе знаний сервиса. Их сохраняет сервер — просто верни их',
    'текстом в JSON (ниже). Правь только те, которых изменение касается; остальные не трогай.',
    args.affected.length
      ? `Задетые статьи (верни тот же id, если статью надо обновить):\n${args.affected.map((d) => `- ${d.id} · ${d.title}`).join('\n')}`
      : 'Подходящих статей раздела проекта нет — заведи одну новую, если изменение того стоит.',
    '',
    'Требования к объёму: не переписывай статьи, которых изменение не касается; не пересказывай диф построчно;',
    `не больше ${MAX_DOCUMENTS} статей в ответе. Если изменение на базу знаний не влияет (правка тестов,`,
    'форматирование, мелкий рефакторинг без смены поведения) — ничего не меняй и верни nothingToUpdate.',
    args.gaps?.length
      ? 'На пробелы базы знаний это исключение не распространяется: их закрывают, даже если сам диф базы не касается.'
      : '',
    '',
    'Финальный ответ должен содержать ровно один JSON-объект полного формата ниже.',
    'Не добавляй markdown fences, промежуточный отчёт, пояснительный текст или любые символы до/после JSON:',
    '{"note":"что записал одной фразой","nothingToUpdate":false,"topics":["protocol"],"documents":[{"id":"id существующей статьи или пусто","title":"Заголовок","kind":"subsystem","tags":["..."],"areas":["path/to/file.ts"],"body":"# Заголовок\\n\\nТекст статьи"}]}'
  ]
    .filter((l) => l !== '')
    .join('\n')
}

/** Результат разбора ответа модели по шагу актуализации. */
export interface KbUpdateOutput {
  note: string
  /** Модель сочла, что записывать нечего. */
  nothingToUpdate: boolean
  /** Файловые темы, которые модель правила (для строки в ленте шага). */
  topics: string[]
  documents: ResearchDocument[]
}

export type KbUpdateParseErrorCode = 'json_not_found' | 'ambiguous_json' | 'invalid_json' | 'invalid_contract'

/** Ошибка без текста ответа модели: код пригоден для короткого UI-сообщения, detail — для технического лога. */
export class KbUpdateParseError extends Error {
  constructor(readonly code: KbUpdateParseErrorCode, detail: string) {
    super(detail)
    this.name = 'KbUpdateParseError'
  }
}

const UPDATE_KINDS = new Set<KbDocumentKind>(['feature', 'subsystem', 'protocol', 'decision', 'convention', 'runbook', 'package'])
const ROOT_FIELDS = new Set(['note', 'nothingToUpdate', 'topics', 'documents'])
const DOCUMENT_FIELDS = new Set(['id', 'title', 'kind', 'tags', 'areas', 'body'])

function looksLikeKbUpdateObject(value: string): boolean {
  const text = value.trim()
  return text.startsWith('{') && /"(?:note|nothingToUpdate|topics|documents)"\s*:/.test(text)
}

/**
 * Транспортный слой ответа: чистый JSON имеет приоритет; иначе принимается ровно
 * один явный fence json либо один немаркированный fence, похожий на контракт.
 * Фигурные скобки вне fence намеренно не используются для поиска кандидата.
 */
export function extractKbUpdateJson(raw: string): unknown {
  const text = raw.trim()
  if (!text) throw new KbUpdateParseError('json_not_found', 'JSON не найден: ответ пуст')
  try {
    return JSON.parse(text) as unknown
  } catch {
    // Ответ может быть транспортной обёрткой с отчётом — разбираем только fences.
  }

  const candidates: string[] = []
  const fence = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g
  for (const match of text.matchAll(fence)) {
    const label = (match[1] ?? '').trim().toLowerCase()
    const body = (match[2] ?? '').trim()
    if (label === 'json' || (!label && looksLikeKbUpdateObject(body))) candidates.push(body)
  }
  if (candidates.length > 1) {
    throw new KbUpdateParseError('ambiguous_json', `Найдено несколько JSON-кандидатов: ${candidates.length}`)
  }
  if (!candidates.length) {
    if (looksLikeKbUpdateObject(text)) {
      throw new KbUpdateParseError('invalid_json', 'JSON синтаксически повреждён')
    }
    throw new KbUpdateParseError('json_not_found', 'JSON не найден ни как чистый ответ, ни в поддерживаемом fenced-блоке')
  }
  try {
    return JSON.parse(candidates[0]!) as unknown
  } catch (err) {
    throw new KbUpdateParseError('invalid_json', `JSON синтаксически повреждён: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function contractError(detail: string): never {
  throw new KbUpdateParseError('invalid_contract', `JSON не соответствует контракту: ${detail}`)
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) contractError(`поле ${path} должно быть массивом строк`)
  return value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) contractError(`поле ${path}[${index}] должно быть непустой строкой`)
    return item.trim()
  })
}

function exactFields(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length) contractError(`${path} содержит неизвестные поля: ${unknown.join(', ')}`)
}

/** Схема содержимого проверяется целиком до того, как вызывающий начнёт запись документов. */
export function validateKbUpdateJson(value: unknown): KbUpdateOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) contractError('корень должен быть объектом')
  const root = value as Record<string, unknown>
  exactFields(root, ROOT_FIELDS, 'корень')
  if (typeof root.note !== 'string') contractError('поле note обязательно и должно быть строкой')
  if (typeof root.nothingToUpdate !== 'boolean') contractError('поле nothingToUpdate обязательно и должно быть boolean')
  const topics = stringArray(root.topics, 'topics')
  if (!Array.isArray(root.documents)) contractError('поле documents обязательно и должно быть массивом')
  if (root.documents.length > MAX_DOCUMENTS) contractError(`documents содержит больше ${MAX_DOCUMENTS} элементов`)

  const documents = root.documents.map((item, index): ResearchDocument => {
    const path = `documents[${index}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) contractError(`${path} должен быть объектом`)
    const doc = item as Record<string, unknown>
    exactFields(doc, DOCUMENT_FIELDS, path)
    if (typeof doc.id !== 'string') contractError(`${path}.id обязательно и должно быть строкой`)
    if (typeof doc.title !== 'string' || !doc.title.trim()) contractError(`${path}.title обязательно и должно быть непустой строкой`)
    if (typeof doc.kind !== 'string' || !UPDATE_KINDS.has(doc.kind as KbDocumentKind)) contractError(`${path}.kind содержит недопустимое значение`)
    const tags = stringArray(doc.tags, `${path}.tags`)
    const areas = stringArray(doc.areas, `${path}.areas`)
    if (typeof doc.body !== 'string' || !doc.body.trim()) contractError(`${path}.body обязательно и должно быть непустой строкой`)
    const body = doc.body.trim()
    return {
      ...(doc.id.trim() ? { id: doc.id.trim() } : {}),
      title: doc.title.trim(),
      kind: doc.kind as KbDocumentKind,
      tags,
      areas,
      body: body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n\n[…текст обрезан сервером]` : body
    }
  })

  if (root.nothingToUpdate && (topics.length > 0 || documents.length > 0)) {
    contractError('nothingToUpdate=true несовместимо с непустыми topics или documents')
  }
  if (!root.nothingToUpdate && topics.length === 0 && documents.length === 0) {
    contractError('nothingToUpdate=false требует хотя бы одну тему или документ')
  }
  return { note: root.note.trim(), nothingToUpdate: root.nothingToUpdate, topics, documents }
}

export function parseKbUpdateOutput(raw: string): KbUpdateOutput {
  return validateKbUpdateJson(extractKbUpdateJson(raw))
}

/** Строка для ленты шага: что именно ушло в базу знаний. */
export function formatKbUpdateSummary(out: KbUpdateOutput, saved: Array<{ title: string; action: 'created' | 'updated' }>): string {
  if (out.nothingToUpdate && !saved.length) return `Нечего обновлять${out.note ? `: ${out.note}` : ''}`
  const parts: string[] = []
  if (out.topics.length) parts.push(`темы репозитория: ${out.topics.join(', ')}`)
  if (saved.length) parts.push(`статьи проекта: ${saved.map((d) => `${d.title} (${d.action === 'created' ? 'создана' : 'обновлена'})`).join('; ')}`)
  return `База знаний обновлена — ${parts.join('; ') || 'без изменений'}${out.note ? `. ${out.note}` : ''}`
}

/** Статьи раздела проекта в виде, пригодном для выбора задетых. */
export function affectedProjectDocs(docs: KbStoredDocument[], files: string[]): Array<{ id: string; title: string; areas: string[] }> {
  return pickAffectedDocs(files, docs.map((d) => ({ id: d.id, title: d.title, areas: d.areas })))
}
