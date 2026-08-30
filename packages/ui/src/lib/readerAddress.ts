// Что панель Playwright Reader говорит про открытый адрес.
//
// Три вопроса, на которые до круга 13 она не отвечала: куда на самом деле ушёл
// запрос (адрес мог подмениться алиасом раннера), где я уже был и та ли это
// вообще страница, которую проверяем.

/**
 * Подмена адреса алиасом. Раннер переписывает внешний `host:port` на внутренний,
 * чтобы достучаться до собственного стенда; человек при этом видит в поле одно,
 * а страница загружена с другого адреса. Молчать об этом нельзя — расхождение
 * выглядит как «открылось не то».
 */
export function aliasNote(requested: string, actual: string | null): string | null {
  if (!actual) return null
  try {
    const from = new URL(requested)
    const to = new URL(actual)
    if (from.host === to.host) return null
    return `Запрошен ${from.host}, страница загружена с ${to.host}: адрес подменён алиасом раннера.`
  } catch { return null }
}

/** История адресов сессии: без повторов подряд и с ограничением длины. */
export function pushHistory(history: string[], url: string | null, limit = 20): string[] {
  if (!url) return history
  if (history[0] === url) return history
  return [url, ...history.filter((item) => item !== url)].slice(0, limit)
}

/**
 * Совпадает ли происхождение страницы с ожидаемым. Ожидаемым считается адрес,
 * с которого начали: уход на другой хост посреди проверки — это либо редирект
 * на внешний вход, либо промах, и в обоих случаях об этом надо знать.
 */
export function offOrigin(expected: string | null, actual: string | null, aliasExplains = false): boolean {
  // Подмена алиасом объясняет смену хоста сама: показывать рядом ещё и тревогу
  // «ушли с сайта» — значит пугать человека тем, что он сам и настроил.
  if (aliasExplains || !expected || !actual) return false
  try { return new URL(expected).origin !== new URL(actual).origin } catch { return false }
}
