// Разбиение потока текста на озвучиваемые чанки для стриминговой TTS.
// - обычный текст режется на завершённые предложения;
// - блоки кода (```…```) не озвучиваются: вместо них — фраза-заглушка;
// - незакрытый блок кода/незавершённое предложение остаётся в «хвосте» (rest)
//   и копится до следующего токена или до финала.

/** Фраза вместо блока кода в озвучке. */
export const CODE_SPEECH = 'Далее пример кода.'

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

/**
 * Разбивает на озвучиваемые чанки с учётом блоков кода. Завершённый блок ```…```
 * заменяется на CODE_SPEECH. Незакрытый блок кода (стриминг ещё идёт) целиком
 * уходит в rest — озвучится/заменится позже, когда закроется.
 */
export function splitSpeakable(text: string): { chunks: string[]; rest: string } {
  const chunks: string[] = []
  let t = text
  for (;;) {
    const open = t.indexOf('```')
    if (open === -1) {
      const { sentences, rest } = splitSentences(t)
      chunks.push(...sentences)
      return { chunks, rest }
    }
    const before = t.slice(0, open)
    const closeRel = t.slice(open + 3).indexOf('```')
    // текст до блока — по предложениям
    const { sentences, rest: beforeRest } = splitSentences(before)
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
 * незавершённый блок кода (чтобы он стал заглушкой, а не был озвучен) и включая
 * незавершённое последнее предложение.
 */
export function flushSpeakable(text: string): string[] {
  const fences = text.match(/```/g)?.length ?? 0
  const closed = fences % 2 === 1 ? text + '\n```' : text
  const { chunks, rest } = splitSpeakable(closed)
  const out = [...chunks]
  if (rest.trim()) out.push(rest.trim())
  return out
}
