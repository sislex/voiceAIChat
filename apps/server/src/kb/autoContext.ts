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

import { estimateKbTokens, type KbContextBundle, type TurnRequestInfo } from '@voicechat/shared'
import type { KbView, KnowledgeBaseService } from './types.js'
import type { KbUsageSectionInput } from './usage.js'

/** Бюджет контекста (символы) — один и тот же в чате и в ране. */
export const KB_AUTO_CONTEXT_BUDGET = 3500

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
  emptyReason: 'no-match' | 'low-confidence' | null
}

/**
 * Собрать контекст БЗ по запросу. `view` — права спрашивающего (kb/access.ts):
 * модуль их не считает и не расширяет.
 */
export async function buildKbAutoContext(
  kb: KnowledgeBaseService,
  query: string,
  view: KbView,
  budget: number = KB_AUTO_CONTEXT_BUDGET
): Promise<KbAutoContext> {
  const bundle = await kb.context(query, budget, view)
  if (!bundle.autoInjectAllowed || !bundle.sections.length) {
    return {
      bundle,
      text: '',
      sections: [],
      contextSections: [],
      emptyReason: bundle.sections.length ? 'low-confidence' : 'no-match'
    }
  }
  // Первые два результата несут тело раздела целиком. Остальные — дешёвая
  // навигация к kb:document. Бюджет применяется к готовому тексту, включая
  // заголовок и разделители: только это число соответствует реальному промпту.
  const prefix = `\n\n${KB_CONTEXT_HEADING}\nИспользуй как навигацию и сверяй с кодом при изменении поведения.\n\n`
  const selected: typeof bundle.sections = []
  const blocks: string[] = []
  let chars = prefix.length
  for (const section of bundle.sections) {
    const ref = `${section.documentId}${section.anchor ? `#${section.anchor}` : ''}`
    const block = selected.length < 2
      ? `### ${section.title} / ${section.heading}\nИсточник: ${section.sourcePath}${section.anchor ? `#${section.anchor}` : ''}\n${section.text}`
      : `${section.title} / ${section.heading} · \`${ref}\``
    const added = (blocks.length ? 2 : 0) + block.length
    if (chars + added > budget) break
    selected.push(section)
    blocks.push(block)
    chars += added
  }
  if (!blocks.length) {
    return { bundle, text: '', sections: [], contextSections: [], emptyReason: 'no-match' }
  }
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
    emptyReason: null
  }
}
