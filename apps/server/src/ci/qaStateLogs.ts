// Обрезка логов исторических QA-ранов в состоянии задачи. Вынесено отдельной
// чистой функцией, потому что цена ошибки здесь — не косметика: полный лог у
// каждой попытки складывался в многомегабайтный ответ, вкладка вставала, а
// сервер выедал heap и уходил в цикл рестартов (прод, 2026-09-05).

/** Сколько символов лога остаётся у исторических попыток. */
export const QA_STATE_LOG_TAIL_CHARS = 4_000

/**
 * Полный лог остаётся у активной и у последней попытки — именно их открывают в
 * ленте. Остальным достаётся хвост: конец лога информативен, начало — нет.
 */
export function trimHistoricalRunLogs<T extends { id: string; log: string }>(
  runs: readonly T[],
  keepIds: ReadonlyArray<string | null | undefined>,
  tailChars = QA_STATE_LOG_TAIL_CHARS
): T[] {
  const keep = new Set(keepIds.filter((id): id is string => Boolean(id)))
  return runs.map((run) => (keep.has(run.id) ? run : { ...run, log: run.log.slice(-tailChars) }))
}
