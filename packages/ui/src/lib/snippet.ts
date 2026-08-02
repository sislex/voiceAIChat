// Разбор сниппета поиска. Сервер помечает совпадения `<mark>…</mark>`, но текст
// сообщения произволен (в нём бывает и код, и разметка), поэтому вставлять
// сниппет как HTML нельзя — разбираем его на куски и рисуем React-ом.

export interface SnippetPart {
  text: string
  /** Совпадение — рисуется <mark>. */
  hit: boolean
}

const OPEN = '<mark>'
const CLOSE = '</mark>'

/**
 * Режет сниппет на чередующиеся куски «обычный текст / совпадение».
 * Непарные и вложенные метки не ломают разбор: лишняя открывающая просто
 * тянется до конца строки, лишняя закрывающая считается текстом.
 */
export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = []
  let rest = snippet
  while (rest.length > 0) {
    const open = rest.indexOf(OPEN)
    if (open === -1) {
      parts.push({ text: rest, hit: false })
      break
    }
    if (open > 0) parts.push({ text: rest.slice(0, open), hit: false })
    const after = rest.slice(open + OPEN.length)
    const close = after.indexOf(CLOSE)
    if (close === -1) {
      if (after.length > 0) parts.push({ text: after, hit: true })
      break
    }
    if (close > 0) parts.push({ text: after.slice(0, close), hit: true })
    rest = after.slice(close + CLOSE.length)
  }
  return parts
}
