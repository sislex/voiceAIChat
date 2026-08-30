// Типы модуля «сессии и устройства». Пакет намеренно без зависимостей: его
// забирают в чужое приложение целиком, вместе с политиками и портами, поэтому
// здесь нет ни react, ни транспорта, ни знания о конкретной БД.

/** Класс устройства — по нему UI выбирает иконку, а политики отличают ботов от людей. */
export type DeviceKind = 'phone' | 'tablet' | 'desktop' | 'bot' | 'unknown'

/** Разобранный User-Agent. `legacy` — вход, случившийся до появления учёта устройств. */
export interface DeviceProfile {
  browser: string
  /** Мажорная версия браузера; null — в строке её нет (curl, боты, обрезанный UA). */
  browserVersion: string | null
  os: string
  osVersion: string | null
  kind: DeviceKind
  /** Готовая нейтральная подпись вида «Chrome 128 · macOS»; для legacy — пустая строка. */
  label: string
  legacy: boolean
}

/** Что известно об адресе. `label` уже пригоден для показа, остальное — для фильтров. */
export interface GeoInfo {
  /** ISO-код страны в верхнем регистре. */
  country?: string
  city?: string
  /** Приватный адрес: города нет и не будет, показываем «локальная сеть». */
  local?: boolean
  label: string
}

/**
 * Сессия устройства — источник истины для типа. Транспортный DTO приложения
 * (`SessionInfo` в @voicechat/shared) обязан оставаться его подмножеством:
 * все поля сверх базовых — опциональные, чтобы старые записи читались как есть.
 */
export interface DeviceSession {
  sid: string
  user: string
  createdAt: number
  lastSeen: number
  expiresAt: number
  ip: string
  userAgent: string
  /** Та сессия, из которой сделан текущий запрос. */
  current?: boolean
  /** Имя, заданное пользователем («Рабочий ноут»); null — показываем разбор UA. */
  label?: string | null
  /** Стабильный ключ устройства: на нём держатся доверие и дедупликация. */
  deviceKey?: string | null
  /** Момент, когда устройство отметили доверенным; null — обычное. */
  trustedAt?: number | null
  platform?: string | null
  clientVersion?: string | null
  geo?: GeoInfo | null
  /** Сколько раз отмечалась активность (реализация вправе экономить записи). */
  requests?: number
  lastPath?: string | null
  /**
   * Хеш секрета устройства (например, из долгоживущей cookie). Ядро его не
   * вычисляет и не сравнивает — только переносит: доверие обязано опираться на
   * секрет, а не на User-Agent и подсеть, которые подделываются.
   */
  deviceSecret?: string | null
  /** Сессия уже завершена (отозвана или истекла): в списке живых её нет. */
  ended?: boolean
  endedAt?: number
}

/** Данные новой сессии: всё, что известно в момент входа. */
export interface NewSession {
  sid: string
  user: string
  ip: string
  userAgent: string
  ttlMs: number
  deviceKey?: string | null
  platform?: string | null
  clientVersion?: string | null
  geo?: GeoInfo | null
  deviceSecret?: string | null
}

/** Что разрешено менять у существующей сессии. */
export interface SessionPatch {
  label?: string | null
  /** true — пометить доверенной сейчас, false — снять доверие. */
  trusted?: boolean
  geo?: GeoInfo | null
}

/** Настройки срока жизни и лимитов. Приложение подменяет их целиком. */
export interface SessionPolicy {
  /** TTL с «запомнить меня». */
  ttlMs: number
  /** TTL без «запомнить меня» — сессионная cookie, короткий срок. */
  shortTtlMs: number
  /** Максимум живых сессий на пользователя; null — без ограничения. */
  maxConcurrent: number | null
  /** Через сколько дней без активности сессия считается брошенной; null — не чистить. */
  staleDays: number | null
  /** Сколько дней действует отметка «доверенное устройство». */
  trustDays: number
  /** Окно, в котором сессия показывается как «активна сейчас». */
  onlineWindowMs: number
}

/** TTL сессии: «запомнить меня» — 30 дней без активности; без него — 12 часов. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000
export const SESSION_SHORT_TTL_MS = 12 * 60 * 60_000

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  ttlMs: SESSION_TTL_MS,
  shortTtlMs: SESSION_SHORT_TTL_MS,
  maxConcurrent: null,
  staleDays: null,
  trustDays: 30,
  onlineWindowMs: 2 * 60_000
}
