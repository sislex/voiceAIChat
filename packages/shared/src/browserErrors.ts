// Ошибки изолированного Chromium словами человека.
//
// Раннер отдавал две категории текста как есть. Первая — сетевые ошибки
// Playwright: «page.goto: net::ERR_NAME_NOT_RESOLVED at http://…», и в панели, и
// в вердикте этапа человек читал код движка. Вторая — собственные коды раннера
// (`not_found`, `stale_incarnation`, `stale_tab`): они уходили в поле `message`
// и печатались в панели буквально. Перевод живёт в shared, потому что нужен
// трём сторонам: раннеру (сетевые ошибки), серверу (коды) и панели (реакция на
// потерянную сессию).

/** Коды, при которых сессии больше нет и команды в неё бессмысленны. */
export const BROWSER_SESSION_LOST_CODES = ['not_found', 'stale_incarnation'] as const

export function isBrowserSessionLostCode(code: unknown): boolean {
  return typeof code === 'string' && (BROWSER_SESSION_LOST_CODES as readonly string[]).includes(code)
}

const RUNNER_CODE_MESSAGES: Record<string, string> = {
  not_found: 'Сессия Chromium закрыта: её убрал сборщик простоя или раннер перезапускался. Перезапустите панель.',
  stale_incarnation: 'Сессия Chromium пересоздана, команда адресована прежней. Перезапустите панель.',
  stale_tab: 'Вкладка уже закрыта или не существует: выберите другую.',
  start_failed: 'Изолированный Chromium не запустился.'
}

/** Человеческий текст по коду раннера; `null` — это не код, а уже текст. */
export function describeBrowserRunnerCode(code: unknown): string | null {
  return typeof code === 'string' ? RUNNER_CODE_MESSAGES[code] ?? null : null
}

/**
 * Сетевые коды Chromium, которые встречаются при проверке сайтов. Каждый — своя
 * беда со своим действием: «имя не разрешается» правят в адресе, «заблокировано
 * политикой» — у оператора, «сертификат» — в конфигурации доверия раннера.
 */
const NET_ERROR_MESSAGES: Record<string, string> = {
  ERR_NAME_NOT_RESOLVED: 'имя сайта не разрешается (проверьте адрес)',
  ERR_BLOCKED_BY_CLIENT: 'адрес заблокирован политикой раннера: внутренние сети закрыты, сюда пускает только алиас оператора',
  ERR_CONNECTION_REFUSED: 'сервер отказал в соединении: на этом адресе и порту никто не слушает',
  ERR_CONNECTION_TIMED_OUT: 'сервер не отвечает: соединение не установилось за отведённое время',
  ERR_CONNECTION_RESET: 'сервер сбросил соединение',
  ERR_CONNECTION_CLOSED: 'сервер закрыл соединение, не ответив',
  ERR_EMPTY_RESPONSE: 'сервер ответил пустым ответом',
  ERR_INTERNET_DISCONNECTED: 'у раннера нет сети',
  ERR_CERT_AUTHORITY_INVALID: 'сертификат сайта выдан неизвестным центром: раннеру нужен дополнительный CA (VC_BROWSER_EXTRA_CA_*)',
  ERR_CERT_COMMON_NAME_INVALID: 'сертификат сайта выдан на другое имя',
  ERR_CERT_DATE_INVALID: 'сертификат сайта просрочен или ещё не действует',
  ERR_SSL_PROTOCOL_ERROR: 'сайт не говорит по TLS на этом порту: возможно, нужен http вместо https',
  ERR_TOO_MANY_REDIRECTS: 'сайт зациклился на перенаправлениях',
  ERR_ABORTED: 'загрузка прервана',
  ERR_HTTP_RESPONSE_CODE_FAILURE: 'сервер ответил кодом ошибки',
  ERR_INVALID_URL: 'адрес не разбирается'
}

/**
 * Перевод ошибки навигации. Возвращает `null`, если текст не про сеть — тогда
 * вызывающий оставляет его как есть, а не подменяет «примерно тем же».
 */
export function describeNavigationError(raw: string): string | null {
  const text = raw.split('\n')[0]
  const at = / at (\S+)/.exec(text)?.[1]
  const where = at ? ` — ${at}` : ''
  const code = /net::(ERR_[A-Z0-9_]+)/.exec(text)?.[1]
  if (code) {
    const known = NET_ERROR_MESSAGES[code]
    return known ? `Страница не открылась: ${known}${where}` : `Страница не открылась: ${code}${where}`
  }
  const timeout = /Timeout (\d+)ms exceeded/.exec(text)
  if (timeout) return `Страница не загрузилась за ${Math.round(Number(timeout[1]) / 1000)} с${where}`
  if (/Cannot navigate to invalid URL/i.test(text)) return `Адрес не разбирается${where}`
  return null
}

/** Текст ошибки навигации словами; нераспознанное — первой строкой как есть. */
export function humanizeNavigationError(raw: string): string {
  return describeNavigationError(raw) ?? raw.split('\n')[0]
}
