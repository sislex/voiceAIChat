// Поиск пересекающихся задач: ассистент обязан спросить себя «а нет ли уже
// такой задачи», прежде чем заводить новую. Дубликат на доске стоит дороже
// лишнего вопроса — две ветки на одну правку расходятся и конфликтуют в merge.
//
// Логика намеренно лексическая и чистая: она не решает за модель, а приносит
// ей кандидатов с объяснением, почему они похожи. Решение остаётся за моделью.

/** Слишком общие слова: их совпадение ничего не значит. */
const STOP_WORDS = new Set([
  'и', 'или', 'не', 'на', 'в', 'во', 'по', 'для', 'при', 'из', 'от', 'до', 'над', 'под', 'что', 'это',
  'как', 'без', 'же', 'бы', 'то', 'так', 'чтобы', 'если', 'все', 'весь', 'вся', 'уже', 'ещё', 'еще',
  'the', 'a', 'an', 'and', 'or', 'not', 'for', 'with', 'to', 'of', 'in', 'on', 'is', 'are', 'be',
  'задача', 'задачу', 'сделать', 'нужно', 'надо', 'добавить', 'починить', 'исправить', 'fix', 'add', 'task'
])

/** Слова текста без пунктуации, регистра, стоп-слов и слишком коротких токенов. */
export function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
  )
}

export interface SimilarityItem {
  id: string
  title: string
  description?: string
  acceptanceCriteria?: string
  labels?: string[]
  skills?: string[]
}

export interface SimilarityHit {
  id: string
  /** 0..1; чем ближе к 1, тем больше пересечение с запросом. */
  score: number
  /** Совпавшие значимые слова — объяснение для модели и для пользователя. */
  overlap: string[]
}

/** Совпадение в заголовке весит больше, чем в описании: заголовок и есть суть задачи. */
const TITLE_WEIGHT = 3
const META_WEIGHT = 2
const BODY_WEIGHT = 1

/** Начиная с этого значения пересечение считается сильным и требует объяснения. */
export const STRONG_SIMILARITY = 0.4

export function rankSimilarTasks(query: SimilarityItem, candidates: SimilarityItem[], limit = 5): SimilarityHit[] {
  const queryTitle = significantWords(query.title)
  const queryBody = significantWords([query.description ?? '', query.acceptanceCriteria ?? ''].join(' '))
  const queryMeta = new Set([...(query.labels ?? []), ...(query.skills ?? [])].map((item) => item.toLocaleLowerCase()))
  const queryWeight = queryTitle.size * TITLE_WEIGHT + queryBody.size * BODY_WEIGHT + queryMeta.size * META_WEIGHT
  if (queryWeight === 0) return []

  return candidates
    .filter((candidate) => candidate.id !== query.id)
    .map((candidate) => {
      const title = significantWords(candidate.title)
      const body = significantWords([candidate.description ?? '', candidate.acceptanceCriteria ?? ''].join(' '))
      const meta = new Set([...(candidate.labels ?? []), ...(candidate.skills ?? [])].map((item) => item.toLocaleLowerCase()))
      const overlap = new Set<string>()
      let weight = 0
      for (const word of queryTitle) {
        // Слово из заголовка запроса, встреченное в заголовке кандидата, — самый
        // сильный сигнал; в теле кандидата оно тоже что-то значит.
        if (title.has(word)) { weight += TITLE_WEIGHT; overlap.add(word) }
        else if (body.has(word)) { weight += BODY_WEIGHT; overlap.add(word) }
      }
      for (const word of queryBody) {
        if (title.has(word) || body.has(word)) { weight += BODY_WEIGHT; overlap.add(word) }
      }
      for (const word of queryMeta) {
        if (meta.has(word)) { weight += META_WEIGHT; overlap.add(word) }
      }
      return { id: candidate.id, score: Math.min(1, weight / queryWeight), overlap: [...overlap] }
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, limit))
}
