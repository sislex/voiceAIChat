// Авто-инъекция контекста базы знаний в промпт: ОДНА реализация на ход чата
// (turns.ts) и на ход модели в CI-ране (ci/modelHooks.ts).
//
// Зачем отдельный модуль. Порог уверенности (`autoInjectAllowed`), формат блоков
// и точные символы каждого раздела — это то, что панель «Использование БЗ»
// показывает как факт. Вторая копия логики означала бы, что в чате и в ране
// одинаковый запрос даёт разные числа, а объяснить это пользователю нечем.
//
// Модуль ничего не пишет и не ловит ошибки: телеметрию и «БЗ не роняет ход»
// решает вызывающий (у него свой трекер и свой хендл обращения).

import { estimateKbTokens, type KbContextBundle, type KbContextSection, type KbMatchType, type TurnRequestInfo } from '@voicechat/shared'
import { areaTouchesPath, kbCodeQuery, prepareKbQuery, type KbQuery } from './taskQuery.js'
import type { KbView, KnowledgeBaseService } from './types.js'
import type { KbEmptyReason, KbUsageSectionInput } from './usage.js'

/** Бюджет контекста (символы) — один и тот же в чате и в ране. */
export const KB_AUTO_CONTEXT_BUDGET = 3500

/**
 * Меньше этого куска тела раздел отдавать бессмысленно — от него останется
 * заголовок и обрывок фразы; вместо него уходит компактная ссылка.
 */
const MIN_BODY_CHARS = 400

/** Совпадение метаданных: сигнал сильный сам по себе, без порога уверенности. */
const EXACT_MATCH: readonly KbMatchType[] = ['symbol', 'alias', 'path', 'protocol']

/** Заголовок блока: по нему модель отличает контекст БЗ от остального промпта. */
export const KB_CONTEXT_HEADING = '## Контекст базы знаний voiceAIChat'

type KbContextInfo = NonNullable<TurnRequestInfo['kbContext']>

export interface KbAutoContext {
  bundle: KbContextBundle
  /**
   * Готовый кусок промпта (начинается с пустой строки) — дописывается как есть.
   * Пусто — инъекции нет: либо ничего не нашлось, либо уверенность низкая.
   */
  text: string
  /** Разделы для трекера: `chars` — точная длина блока каждого раздела. */
  sections: KbUsageSectionInput[]
  /** Разделы для панели «Подробнее» хода (meta.request.kbContext). */
  contextSections: KbContextInfo['sections']
  /** Почему инъекции нет (аргумент `usage.empty`); null — инъекция есть. */
  emptyReason: KbEmptyReason | null
  /** Какая дорожка дала разделы: проза или пути с именами символов. */
  lane: 'lexical' | 'code' | null
}

/** Ссылка на раздел в формате инструмента `kb:document`. */
function refOf(section: KbContextSection): string {
  return `${section.documentId}${section.anchor ? `#${section.anchor}` : ''}`
}

/**
 * Тело раздела под остаток бюджета. Раздел длиннее бюджета — не повод не давать
 * ничего: отдаём начало и ссылку, по которой модель дочитает целиком. Так же
 * поступает и сам инструмент `kb:document` со своим капом.
 *
 * Обрезка разрешена только первому блоку (`trim`). Инъекция не должна пухнуть
 * ради попадания: если тело целиком не влезло, а что-то в промпте уже есть,
 * дешевле отдать ссылку, чем добивать бюджет обрывком второго раздела.
 */
function fitBody(section: KbContextSection, room: number, trim: boolean): string | null {
  if (section.text.length <= room) return section.text
  if (!trim) return null
  const note = `\n\n…[раздел обрезан по бюджету контекста, целиком — kb:document \`${refOf(section)}\`]`
  const room2 = room - note.length
  if (room2 < MIN_BODY_CHARS) return null
  const cut = section.text.slice(0, room2)
  // Рвём по границе абзаца или слова: обрывок посреди слова читается как сбой.
  const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '))
  return `${(at > room2 / 2 ? cut.slice(0, at) : cut).trimEnd()}${note}`
}

/**
 * Кодовая дорожка: разделы, привязанные к упомянутым в задаче путям и символам.
 * Работает по `areas` (они же `related_files` раздела) и точным совпадениям
 * метаданных, поэтому порог уверенности ей не нужен — сигнал и так точный.
 */
async function codeLaneSections(
  kb: KnowledgeBaseService,
  parts: KbQuery,
  budget: number,
  view: KbView
): Promise<KbContextBundle | null> {
  const query = kbCodeQuery(parts)
  if (!query) return null
  const bundle = await kb.context(query, budget, view)
  const sections = bundle.sections.filter((section) =>
    section.matchTypes.some((type) => EXACT_MATCH.includes(type)) ||
    section.relatedFiles.some((area) => parts.paths.some((path) => areaTouchesPath(area, path))))
  return sections.length ? { ...bundle, sections } : null
}

/**
 * Собрать контекст БЗ по запросу. `view` — права спрашивающего (kb/access.ts):
 * модуль их не считает и не расширяет. Строка на входе разбирается на дорожки
 * тут же (kb/taskQuery.ts) — у чата и у рана порядок один.
 */
export async function buildKbAutoContext(
  kb: KnowledgeBaseService,
  query: string | KbQuery,
  view: KbView,
  budget: number = KB_AUTO_CONTEXT_BUDGET
): Promise<KbAutoContext> {
  const parts = typeof query === 'string' ? prepareKbQuery(query) : query
  const lexical = parts.text ? await kb.context(parts.text, budget, view) : null
  let bundle = lexical
  let lane: 'lexical' | 'code' = 'lexical'
  if (!lexical?.autoInjectAllowed || !lexical.sections.length) {
    // Проза не сложилась — идём по путям и символам. Ровно этот случай и есть
    // техническая задача: описание из путей и идентификаторов размывает BM25.
    const code = await codeLaneSections(kb, parts, budget, view)
    if (code) {
      bundle = code
      lane = 'code'
    }
  }
  const empty = (reason: KbEmptyReason): KbAutoContext => ({
    bundle: bundle ?? { query: parts.text, confidence: 'low', autoInjectAllowed: false, sections: [], relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0 },
    text: '', sections: [], contextSections: [], emptyReason: reason, lane: null
  })
  if (!bundle || !bundle.sections.length) return empty('no-match')
  if (lane === 'lexical' && !bundle.autoInjectAllowed) return empty('low-confidence')
  // Первые два результата несут тело раздела целиком. Остальные — дешёвая
  // навигация к kb:document. Бюджет применяется к готовому тексту, включая
  // заголовок и разделители: только это число соответствует реальному промпту.
  const prefix = `\n\n${KB_CONTEXT_HEADING}\nИспользуй как навигацию и сверяй с кодом при изменении поведения.\n\n`
  const selected: KbContextSection[] = []
  const blocks: string[] = []
  let chars = prefix.length
  for (const section of bundle.sections) {
    const room = budget - chars - (blocks.length ? 2 : 0)
    const head = `### ${section.title} / ${section.heading}\nИсточник: ${section.sourcePath}${section.anchor ? `#${section.anchor}` : ''}\n`
    const body = selected.length < 2 ? fitBody(section, room - head.length, !blocks.length) : null
    // Тело не влезло — раздел уходит ссылкой, а не выкидывает весь остаток
    // выдачи: раньше первый же слишком большой раздел давал пустую инъекцию.
    const block = body === null ? `${section.title} / ${section.heading} · \`${refOf(section)}\`` : `${head}${body}`
    if (block.length > room) break
    selected.push(section)
    blocks.push(block)
    chars += block.length + (blocks.length > 1 ? 2 : 0)
  }
  if (!blocks.length) return empty('budget')
  bundle.estimatedTokens = estimateKbTokens(chars)
  return {
    bundle,
    text: `${prefix}${blocks.join('\n\n')}`,
    sections: selected.map((section, index) => ({
      documentId: section.documentId,
      title: section.title,
      heading: section.heading,
      anchor: section.anchor,
      sourcePath: section.sourcePath,
      relatedFiles: section.relatedFiles,
      chars: blocks[index].length,
      score: section.score,
      matchTypes: section.matchTypes,
      freshness: section.freshness
    })),
    contextSections: selected.map(({ documentId, title, heading, sourcePath, anchor, freshness }, index) => ({
      documentId,
      title,
      heading,
      sourcePath,
      anchor,
      freshness,
      chars: blocks[index].length,
      estimatedTokens: estimateKbTokens(blocks[index].length)
    })),
    emptyReason: null,
    lane
  }
}
