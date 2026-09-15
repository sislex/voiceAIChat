import type { BrowserNetworkRule, BrowserNetworkRuleList } from '@voicechat/shared'
import { browserUrlMatches } from '@voicechat/shared'

/**
 * Правила сети: подменить ответ, заблокировать запрос, задержать его.
 *
 * Человек делает это в devtools за минуту — «а что будет, если этот запрос
 * вернёт 500», «а как выглядит страница без аналитики», «а если сеть медленная».
 * Модель не могла ничего из этого: она умела только смотреть журнал запросов
 * постфактум, а воспроизвести условие — нет. Пустая корзина, ошибка сервера и
 * подвисший ответ — это половина состояний интерфейса, и все они были ей
 * недоступны.
 */

/** Сколько правил держим: больше — это уже не проверка, а подмена всего сайта. */
const MAX_RULES = 20
/** Потолок тела подменного ответа: оно едет в память и в ход модели. */
export const RULE_BODY_LIMIT = 256 * 1024

export class NetworkRules {
  private rules: BrowserNetworkRule[] = []

  add(rule: BrowserNetworkRule): BrowserNetworkRuleList {
    if (!rule.url.trim()) throw new Error('Правилу нужен шаблон адреса')
    if (rule.body !== undefined && rule.body.length > RULE_BODY_LIMIT) throw new Error('Тело ответа больше 256 КБ')
    if (rule.delayMs !== undefined && (rule.delayMs < 0 || rule.delayMs > 60_000)) throw new Error('Задержка допустима от 0 до 60000 мс')
    if (this.rules.length >= MAX_RULES) throw new Error(`Больше ${MAX_RULES} правил сети одновременно не держим`)
    // Правило с тем же шаблоном заменяется, а не добавляется вторым: иначе
    // порядок решает, какой ответ увидит страница, и это не воспроизводимо.
    this.rules = [...this.rules.filter((item) => item.url !== rule.url), rule]
    return this.list()
  }

  remove(url?: string): BrowserNetworkRuleList {
    this.rules = url ? this.rules.filter((item) => item.url !== url) : []
    return this.list()
  }

  list(): BrowserNetworkRuleList {
    return { rules: this.rules.map((rule) => ({ ...rule, ...(rule.body ? { body: `${rule.body.slice(0, 200)}${rule.body.length > 200 ? '…' : ''}` } : {}) })), total: this.rules.length }
  }

  /** Правило для адреса: первое совпадение по шаблону с `*`. */
  match(url: string): BrowserNetworkRule | null {
    return this.rules.find((rule) => browserUrlMatches(url, rule.url)) ?? null
  }

  get size(): number {
    return this.rules.length
  }
}

/** Как ответить на перехваченный запрос: отдельная функция ради тестов без браузера. */
export interface RouteOutcome {
  action: 'abort' | 'fulfill' | 'continue'
  status?: number
  body?: string
  contentType?: string
  delayMs?: number
}

export function planRoute(rule: BrowserNetworkRule | null): RouteOutcome {
  if (!rule) return { action: 'continue' }
  if (rule.action === 'block') return { action: 'abort', ...(rule.delayMs ? { delayMs: rule.delayMs } : {}) }
  if (rule.action === 'delay') return { action: 'continue', ...(rule.delayMs ? { delayMs: rule.delayMs } : {}) }
  return {
    action: 'fulfill',
    status: rule.status ?? 200,
    body: rule.body ?? '',
    // JSON по умолчанию: подменяют почти всегда ответ API, и без типа страница
    // разбирает его как текст и падает не там, где интересно.
    contentType: rule.contentType ?? 'application/json; charset=utf-8',
    ...(rule.delayMs ? { delayMs: rule.delayMs } : {})
  }
}
