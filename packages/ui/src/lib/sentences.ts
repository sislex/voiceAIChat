// Разбиение потока текста на озвучиваемые чанки для стриминговой TTS.
// - обычный текст режется на завершённые предложения;
// - блоки кода (```…```) не озвучиваются: вместо них — фраза-заглушка;
// - markdown-таблицы не озвучиваются: вместо них — фраза-заглушка;
// - незакрытый блок кода/таблица/незавершённое предложение остаётся в «хвосте»
//   (rest) и копится до следующего токена или до финала.

/** Фраза вместо блока кода в озвучке. */
export const CODE_SPEECH = 'Далее пример кода.'

/** Фраза вместо таблицы в озвучке. */
export const TABLE_SPEECH = 'Далее таблица.'

export function splitSentences(text: string): { sentences: string[]; rest: string } {
  const sentences: string[] = []
  const re = /[^.!?…\n]*[.!?…\n]+/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    sentences.push(m[0])
    lastIndex = re.lastIndex
  }
  const rest = text.slice(lastIndex)
  return { sentences: sentences.map((s) => s.trim()).filter(Boolean), rest }
}

/** Строка-разделитель markdown-таблицы, напр. `| --- | :--: |`. */
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/
const looksLikeRow = (line: string): boolean => line.includes('|')

/**
 * Заменяет markdown-таблицы на TABLE_SPEECH (содержимое ячеек не озвучивается).
 * Таблица = строка-заголовок с `|`, строка-разделитель (`---`), далее строки с `|`.
 * При `final=false` таблица, тянущаяся до конца буфера, удерживается в `rest`
 * (возможно, ещё дописывается в стриминге).
 */
function collapseTables(text: string, final: boolean): { text: string; rest: string } {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const isTableStart =
      looksLikeRow(lines[i]) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])
    if (isTableStart) {
      let j = i + 2
      while (j < lines.length && lines[j].trim() !== '' && looksLikeRow(lines[j])) j++
      if (j === lines.length && !final) {
        // таблица идёт до конца буфера — держим её до следующего токена/финала
        return { text: out.join('\n'), rest: lines.slice(i).join('\n') }
      }
      out.push(TABLE_SPEECH)
      i = j
    } else {
      out.push(lines[i])
      i++
    }
  }
  return { text: out.join('\n'), rest: '' }
}

/**
 * Разбивает на озвучиваемые чанки с учётом блоков кода и таблиц. Завершённый блок
 * ```…``` заменяется на CODE_SPEECH, таблица — на TABLE_SPEECH. Незакрытый блок
 * кода/таблица (стриминг ещё идёт) уходит в rest — обработается позже.
 */
export function splitSpeakable(text: string, final = false): { chunks: string[]; rest: string } {
  const chunks: string[] = []
  let t = text
  for (;;) {
    const open = t.indexOf('```')
    if (open === -1) {
      const { text: noTables, rest: tableRest } = collapseTables(t, final)
      const { sentences, rest } = splitSentences(noTables)
      chunks.push(...sentences)
      return { chunks, rest: rest + tableRest }
    }
    const before = t.slice(0, open)
    const closeRel = t.slice(open + 3).indexOf('```')
    // текст до блока кода завершён (за ним идёт fence) → таблицы в нём сейлены
    const { text: beforeNoTables } = collapseTables(before, true)
    const { sentences, rest: beforeRest } = splitSentences(beforeNoTables)
    chunks.push(...sentences)

    if (closeRel === -1) {
      // блок кода ещё не закрыт — держим его и «хвост» до следующего токена
      return { chunks, rest: beforeRest + t.slice(open) }
    }
    // лид-ин к коду без знака конца («Вот пример:») — озвучим отдельным чанком
    if (beforeRest.trim()) chunks.push(beforeRest.trim())
    chunks.push(CODE_SPEECH)
    t = t.slice(open + 3 + closeRel + 3)
  }
}

/**
 * Финальный сброс буфера (ответ завершён): отдаёт все оставшиеся чанки, закрывая
 * незавершённый блок кода (→ заглушка) и коллапсируя незавершённые таблицы,
 * включая незавершённое последнее предложение.
 */
export function flushSpeakable(text: string): string[] {
  const fences = text.match(/```/g)?.length ?? 0
  const closed = fences % 2 === 1 ? text + '\n```' : text
  const { chunks, rest } = splitSpeakable(closed, true)
  const out = [...chunks]
  if (rest.trim()) out.push(rest.trim())
  return out
}
