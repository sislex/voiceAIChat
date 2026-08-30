// Разбор User-Agent. Полноценная библиотека вроде ua-parser-js сюда не годится:
// пакет обязан остаться без зависимостей, а список нужен ровно для того, чтобы
// человек узнал своё устройство в списке — точность «браузер + ОС» достаточна.
import type { DeviceKind, DeviceProfile } from './types'

/** Строка UA у сессий, заведённых до появления учёта устройств. */
export const LEGACY_USER_AGENT = 'legacy'

const BOT = /bot\b|crawler|spider|curl\/|wget|python-requests|postmanruntime|node-fetch|axios\/|headlesschrome|playwright|puppeteer/i

// Порядок важен: Edge и Opera представляются Chrome, Chrome на iOS — Safari.
const BROWSERS: Array<[RegExp, string]> = [
  // Electron идёт первым: внутри он тот же Chrome, но для человека это
  // «приложение», а не вкладка браузера, и ключ устройства у них обязан
  // различаться — иначе список склеивает их в одно устройство.
  [/Electron\/([\d.]+)/, 'Electron'],
  [/Edg(?:iOS|A)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/YaBrowser\/(\d+)/, 'Yandex Browser'],
  [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/CriOS\/(\d+)/, 'Chrome'],
  [/FxiOS\/(\d+)/, 'Firefox'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Firefox\/(\d+)/, 'Firefox'],
  [/curl\/([\d.]+)/, 'curl'],
  [/Wget\/([\d.]+)/, 'Wget'],
  [/PostmanRuntime\/([\d.]+)/, 'Postman']
]

// Windows отдаёт версию ядра, а не имя системы; таблица переводит её в привычное.
const WINDOWS_NAMES: Record<string, string> = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' }

function osOf(ua: string): { os: string; osVersion: string | null } {
  const ios = /(?:iPhone|iPad|iPod).*?OS (\d+)[._](\d+)/.exec(ua)
  if (ios) return { os: 'iOS', osVersion: `${ios[1]}.${ios[2]}` }
  if (/iPhone|iPad|iPod/.test(ua)) return { os: 'iOS', osVersion: null }
  const android = /Android (\d+(?:\.\d+)?)/.exec(ua)
  if (android) return { os: 'Android', osVersion: android[1]! }
  if (/Android/.test(ua)) return { os: 'Android', osVersion: null }
  if (/CrOS/.test(ua)) return { os: 'ChromeOS', osVersion: null }
  const mac = /Mac OS X (\d+)[._](\d+)/.exec(ua)
  if (mac) return { os: 'macOS', osVersion: `${mac[1]}.${mac[2]}` }
  if (/Mac OS X|Macintosh/.test(ua)) return { os: 'macOS', osVersion: null }
  const win = /Windows NT (\d+\.\d+)/.exec(ua)
  if (win) return { os: 'Windows', osVersion: WINDOWS_NAMES[win[1]!] ?? win[1]! }
  if (/Windows/.test(ua)) return { os: 'Windows', osVersion: null }
  if (/Linux|X11/.test(ua)) return { os: 'Linux', osVersion: null }
  return { os: '', osVersion: null }
}

function kindOf(ua: string, os: string): DeviceKind {
  if (BOT.test(ua)) return 'bot'
  if (/iPad|Tablet|Nexus (?:7|9|10)|Kindle/i.test(ua)) return 'tablet'
  if (/iPhone|iPod|Windows Phone|Mobile/i.test(ua)) return 'phone'
  // Android без маркера Mobile — по соглашению Google это планшет.
  if (os === 'Android') return 'tablet'
  if (os) return 'desktop'
  return 'unknown'
}

/**
 * Разбирает UA в профиль устройства. Никогда не бросает и на мусорной строке
 * отдаёт `unknown`: список сессий важнее аккуратности разбора.
 */
export function parseUserAgent(userAgent: string | null | undefined): DeviceProfile {
  const ua = (userAgent ?? '').slice(0, 400).trim()
  if (!ua || ua === LEGACY_USER_AGENT) {
    return { browser: '', browserVersion: null, os: '', osVersion: null, kind: 'unknown', label: '', legacy: true }
  }
  const { os, osVersion } = osOf(ua)
  let browser = ''
  let browserVersion: string | null = null
  for (const [pattern, name] of BROWSERS) {
    const m = pattern.exec(ua)
    if (!m) continue
    browser = name
    browserVersion = m[1] ?? null
    break
  }
  // Safari не пишет своё имя: у него есть только Version/ и Safari/ в хвосте, а
  // на iOS между ними ещё вклинивается Mobile/. Поэтому он проверяется после
  // всех, кто маскируется под Safari (Chrome, Edge, Opera, CriOS).
  if (!browser && /Safari\//.test(ua)) {
    browser = 'Safari'
    browserVersion = /Version\/(\d+)/.exec(ua)?.[1] ?? null
  }
  // Незнакомый клиент (агент, скрипт, свой SDK) — берём токен до первого слэша,
  // как это делал прежний разбор: «MyAgent/1.2» читается лучше, чем «неизвестно».
  if (!browser) browser = (ua.split('/')[0] ?? ua).slice(0, 40).trim() || 'Неизвестный клиент'
  const kind = kindOf(ua, os)
  // У Electron версия вида 33.0.0 — в подписи оставляем мажорную, как у прочих.
  const shortVersion = browserVersion ? browserVersion.split('.')[0]! : null
  const head = shortVersion ? `${browser} ${shortVersion}` : browser
  return { browser, browserVersion, os, osVersion, kind, label: os ? `${head} · ${os}` : head, legacy: false }
}

// Отдельной эмодзи для планшета нет, поэтому телефон и планшет делят иконку —
// класс устройства всё равно виден в подписи, а иконка нужна лишь чтобы
// мобильные входы отличались от настольных с одного взгляда.
const ICONS: Record<DeviceKind, string> = { phone: '📱', tablet: '📱', desktop: '💻', bot: '🤖', unknown: '❔' }

/** Иконка класса устройства — общая для всех хостов, чтобы список выглядел одинаково. */
export function deviceIcon(kind: DeviceKind): string {
  return ICONS[kind]
}
