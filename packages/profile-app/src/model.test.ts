import { describe, expect, it } from 'vitest'
import {
  accessSummary,
  activeNowCount,
  activityFeed,
  formatTokens,
  formatUsd,
  isModelDenied,
  isProviderEnabled,
  machineOs,
  machineVersionState,
  modelShares,
  securityEventsToCsv,
  shortUserAgent,
  setAllAccess,
  spendPoints,
  spendTrend,
  toggleAccess
} from './model'
import type { ProfileProvider, ProfileUsage } from './contracts'

const providers: ProfileProvider[] = [
  { id: 'claude', label: 'Anthropic Claude', models: [{ id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'haiku', label: 'Haiku' }] },
  { id: 'codex', label: 'OpenAI Codex', models: [{ id: 'gpt-5', label: 'GPT-5' }, { id: 'o3', label: 'o3' }] }
]

describe('доступ к моделям', () => {
  it('пустой список запретов — полный доступ', () => {
    const summary = accessSummary([], providers)
    expect(summary).toMatchObject({ allowed: 5, denied: 0 })
    expect(summary.byProvider[0]).toMatchObject({ allowed: 3, total: 3, enabled: true })
  })

  it('запрет провайдера закрывает все его модели, но не чужие', () => {
    const denied = [{ provider: 'claude', modelId: '*' }]
    expect(isProviderEnabled(denied, 'claude')).toBe(false)
    expect(isModelDenied(denied, 'claude', 'opus')).toBe(true)
    expect(isModelDenied(denied, 'codex', 'o3')).toBe(false)
    expect(accessSummary(denied, providers)).toMatchObject({ allowed: 2, denied: 3 })
  })

  it('разрешение одной модели снимает общий запрет провайдера и закрывает остальные', () => {
    // Иначе галочка ставится, а доступа нет: запрет '*' её перекрывает.
    const next = toggleAccess([{ provider: 'claude', modelId: '*' }], 'claude', 'opus', true, ['opus', 'sonnet', 'haiku'])
    expect(isProviderEnabled(next, 'claude')).toBe(true)
    expect(isModelDenied(next, 'claude', 'opus')).toBe(false)
    expect(isModelDenied(next, 'claude', 'sonnet')).toBe(true)
    expect(isModelDenied(next, 'claude', 'haiku')).toBe(true)
  })

  it('запрет модели не трогает соседние', () => {
    const next = toggleAccess([], 'codex', 'o3', false)
    expect(next).toEqual([{ provider: 'codex', modelId: 'o3' }])
    expect(isModelDenied(next, 'codex', 'gpt-5')).toBe(false)
  })

  it('«разрешить всё» и «запретить всё»', () => {
    expect(setAllAccess(providers, true)).toEqual([])
    expect(accessSummary(setAllAccess(providers, false), providers)).toMatchObject({ allowed: 0, denied: 5 })
  })
})

describe('форматирование расхода', () => {
  it('нулевая сумма при неизвестном тарифе показывается прочерком, а не нулём', () => {
    expect(formatUsd(0, true)).toBe('—')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(184.2)).toBe('$184.20')
    expect(formatUsd(0.0042)).toBe('$0.0042')
  })

  it('токены сжимаются до k и M', () => {
    expect(formatTokens(940)).toBe('940')
    expect(formatTokens(128_400)).toBe('128.4k')
    expect(formatTokens(8_400_000)).toBe('8.4M')
  })
})

const usage: ProfileUsage = {
  spendUsd: 184.2,
  inputTokens: 6_100_000,
  outputTokens: 2_300_000,
  cacheReadTokens: 0,
  messages: 1284,
  interrupted: 17,
  byModel: [
    { model: 'opus', spendUsd: 96.4, inputTokens: 10, outputTokens: 5 },
    { model: 'gpt-5', spendUsd: 58.2, inputTokens: 8, outputTokens: 4 },
    { model: 'sonnet', spendUsd: 29.6, inputTokens: 6, outputTokens: 3 }
  ],
  byBucket: [
    { bucket: '2026-08-03', spendUsd: 12 },
    { bucket: '2026-08-01', spendUsd: 4 },
    { bucket: '2026-08-02', spendUsd: 9 }
  ]
}

describe('расход по моделям и динамика', () => {
  it('доли считаются от самой дорогой модели', () => {
    const shares = modelShares(usage)
    expect(shares[0]).toMatchObject({ model: 'opus', share: 1 })
    expect(shares[2].share).toBeCloseTo(29.6 / 96.4, 5)
  })

  it('пустой расход не делит на ноль', () => {
    expect(modelShares({ ...usage, byModel: [{ model: 'opus', spendUsd: 0, inputTokens: 0, outputTokens: 0 }] })[0].share).toBe(0)
  })

  it('точки графика идут по возрастанию периода', () => {
    expect(spendPoints(usage).map((point) => point.bucket)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
  })
})

describe('лента активности', () => {
  const events = [
    { id: 1, at: 300, type: 'login', label: 'Вход', ip: '10.0.0.1', userAgent: 'Chrome', details: 'новое устройство' },
    { id: 2, at: 100, type: 'password_changed', label: 'Пароль изменён', ip: '10.0.0.1', userAgent: 'Chrome', details: '' }
  ]
  const chats = [{ id: 'c1', title: 'Рефакторинг API', updatedAt: 200, messageCount: 42 }]

  it('события и разговоры сливаются по времени, свежее сверху', () => {
    const feed = activityFeed(events, chats)
    expect(feed.map((item) => item.id)).toEqual(['event-1', 'chat-c1', 'event-2'])
    expect(feed[0].detail).toContain('новое устройство')
  })

  it('лимит обрезает ленту', () => {
    expect(activityFeed(events, chats, 2)).toHaveLength(2)
  })

  it('без данных лента пуста, а не падает', () => {
    expect(activityFeed([], [])).toEqual([])
  })

  it('разговор без названия не показывается пустой строкой', () => {
    expect(activityFeed([], [{ id: 'c2', title: '', updatedAt: 1, messageCount: 0 }])[0].title).toBe('Без названия')
  })
})

describe('машины', () => {
  it('версия сравнивается с актуальной; без одной из них состояние неизвестно', () => {
    expect(machineVersionState('2.7.4', '2.8.1')).toBe('outdated')
    expect(machineVersionState('2.8.1', '2.8.1')).toBe('current')
    expect(machineVersionState(undefined, '2.8.1')).toBe('unknown')
    expect(machineVersionState('2.8.1', undefined)).toBe('unknown')
  })

  it('ОС берётся из телеметрии; офлайн-машина её не знает', () => {
    expect(machineOs({ id: 'm1', name: 'Mac', online: true, platform: 'darwin', osRelease: '15.6' })).toBe('macOS 15.6')
    expect(machineOs({ id: 'm2', name: 'Srv', online: true, platform: 'linux' })).toBe('Linux')
    expect(machineOs({ id: 'm3', name: 'Off', online: false })).toBeNull()
  })
})

describe('экспорт журнала', () => {
  it('кавычки внутри поля удваиваются, строки не разъезжаются', () => {
    const csv = securityEventsToCsv(
      [{ id: 1, at: 0, type: 'login', label: 'Вход', ip: '10.0.0.1', userAgent: 'Chrome "Beta"', details: 'a,b' }],
      () => '31.08.2026'
    )
    const [header, row] = csv.split('\n')
    expect(header).toBe('"Когда","Событие","IP","Устройство","Детали"')
    expect(row).toBe('"31.08.2026","Вход","10.0.0.1","Chrome ""Beta""","a,b"')
  })

  it('пустой журнал даёт только заголовок', () => {
    expect(securityEventsToCsv([], () => '').split('\n')).toHaveLength(1)
  })
})

describe('активность', () => {
  it('считает только тех, кто был внутри окна', () => {
    const now = 1_000_000
    const users = [{ lastSeenAt: now - 1000 }, { lastSeenAt: now - 600_000 }, { lastSeenAt: null }, {}]
    expect(activeNowCount(users, now, 300_000)).toBe(1)
  })
})

describe('короткая подпись устройства', () => {
  it('оставляет браузер и систему вместо строки на 120 символов', () => {
    expect(shortUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toBe('Chrome 141 · macOS')
    expect(shortUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox 130 · Windows')
    expect(shortUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari 18 · iOS')
    expect(shortUserAgent('agent/2.8.1')).toBe('Агент 2.8.1')
  })

  it('нераспознанное показывает как есть, а не прячет', () => {
    expect(shortUserAgent('curl/8.4.0')).toBe('curl/8.4.0')
    expect(shortUserAgent('')).toBe('')
  })
})

describe('сравнение расхода с прошлым периодом', () => {
  it('доля со знаком, когда прошлый период был ненулевым', () => {
    expect(spendTrend(110, 100)).toEqual({ share: 0.1, up: true })
    expect(spendTrend(80, 100)).toEqual({ share: 0.2, up: false })
  })

  it('сравнивать не с чем — не сравниваем: рост с нуля процентом не выражается', () => {
    expect(spendTrend(50, 0)).toBeNull()
    expect(spendTrend(50, null)).toBeNull()
    expect(spendTrend(50, undefined)).toBeNull()
  })
})
