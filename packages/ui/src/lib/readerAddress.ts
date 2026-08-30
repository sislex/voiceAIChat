// Что панель Playwright Reader говорит про открытый адрес.
//
// Три вопроса, на которые до круга 13 она не отвечала: куда на самом деле ушёл
// запрос (адрес мог подмениться алиасом раннера), где я уже был и та ли это
// вообще страница, которую проверяем.

/**
 * Подмена адреса алиасом. Раннер переписывает внешний `host:port` на внутренний,
 * чтобы достучаться до собственного стенда. Раньше подмену вычисляли по
 * расхождению хостов, потому что наружу приезжал внутренний адрес — а вместе с
 * ним он уезжал и в `startUrl` записанного сценария. Теперь адрес наружу тот,
 * который назвал человек, а факт подмены раннер сообщает полем `aliasedHost`:
 * догадка заменена фактом. Молчать о подмене всё равно нельзя — иначе непонятно,
 * почему страница пришла не оттуда, куда смотрит браузер человека.
 */
export function aliasNote(loaded: string, aliasedHost: string | null | undefined): string | null {
  if (!aliasedHost) return null
  try {
    return `Запрошен ${new URL(loaded).host}, страница загружена с ${aliasedHost}: адрес подменён алиасом раннера.`
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
