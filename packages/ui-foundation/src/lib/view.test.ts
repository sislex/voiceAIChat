import { describe, it, expect } from 'vitest'
import type { ClaudeLogEntry } from '@shared/types'
import { activityLocation, activityStatus, chipClass, clockTime, composerPeek, formatDuration, formatElapsed, formatLiveUsage, messageCost, messageTime, pluralActions } from './view'

const log = (kind: ClaudeLogEntry['kind'], summary: string): ClaudeLogEntry => ({
  kind,
  summary,
  raw: '{}'
})

describe('activityStatus — живая фраза «что происходит»', () => {
  it('нет записей → «Отправляю запрос…» (в thinking)', () => {
    expect(activityStatus([], 'thinking')).toBe('Отправляю запрос…')
  })

  it('нет записей в transcribing → распознавание речи', () => {
    expect(activityStatus([], 'transcribing')).toBe('Распознаю речь…')
  })

  it('Bash с execTarget → «на машине «X»», без него → «на сервере»', () => {
    const entries = [log('tool_use', 'Bash: ls -la')]
    expect(activityStatus(entries, 'thinking', 'macbook')).toBe(
      'Выполняю команду на машине «macbook»…'
    )
    expect(activityStatus(entries, 'thinking')).toBe('Выполняю команду на сервере…')
  })

  it('Read/Edit → работа с файлами; прочий инструмент — по имени', () => {
    expect(activityStatus([log('tool_use', 'Read: a.ts')], 'thinking')).toBe(
      'Работаю с файлами на сервере…'
    )
    expect(activityStatus([log('tool_use', 'Grep: foo')], 'thinking')).toBe(
      'Вызываю инструмент Grep…'
    )
  })

  it('thinking/result — соответствующие фразы', () => {
    expect(activityStatus([log('thinking', '💭 …')], 'thinking')).toBe('Размышляю…')
    expect(activityStatus([log('result', 'Готово')], 'thinking')).toBe('Готово')
  })
})

describe('activityLocation — метка «где» для секции', () => {
  it('tool_use/tool_result — машина или сервер', () => {
    expect(activityLocation(log('tool_use', 'Bash: ls'), 'srv')).toBe('на машине «srv»')
    expect(activityLocation(log('tool_result', 'ok'))).toBe('на сервере')
  })

  it('thinking/system/result — в модели', () => {
    expect(activityLocation(log('thinking', '…'))).toBe('в модели')
    expect(activityLocation(log('system', '…'))).toBe('в модели')
  })
})

describe('pluralActions — склонение «действие»', () => {
  it('склоняет по русским правилам', () => {
    expect(pluralActions(1)).toBe('действие')
    expect(pluralActions(2)).toBe('действия')
    expect(pluralActions(5)).toBe('действий')
    expect(pluralActions(11)).toBe('действий')
    expect(pluralActions(21)).toBe('действие')
  })
})

describe('chipClass — цвет подписи по движку', () => {
  it('Claude и Codex получают разные классы', () => {
    expect(chipClass('ai', true, 'claude')).toBe('chip spa')
    expect(chipClass('ai', true, 'codex')).toBe('chip spx')
  })

  it('без движка (старые сообщения) — как Claude', () => {
    expect(chipClass('ai', true)).toBe('chip spa')
  })

  it('реплики пользователя не зависят от движка', () => {
    expect(chipClass('u1', true)).toBe('chip sp1')
    expect(chipClass('u2', true)).toBe('chip sp2')
    expect(chipClass('u1', false)).toBe('chip sp1')
  })
})

describe('messageTime — время сообщения в поясе зрителя', () => {
  it('форматирует createdAt локальными часами, игнорируя запечённую строку', () => {
    const ts = new Date(2026, 6, 26, 9, 5).getTime() // локальные 09:05
    expect(messageTime({ time: '23:59', createdAt: ts })).toBe('09:05')
  })

  it('без createdAt откатывается к запечённой строке time', () => {
    expect(messageTime({ time: '10:00', createdAt: 0 })).toBe('10:00')
  })
})


describe('formatLiveUsage — живые токены', () => {
  it('показывает входящие, исходящие и весь кэш в компактном виде', () => {
    expect(formatLiveUsage({
      inputTokens: 1200,
      outputTokens: 356,
      cacheReadTokens: 89000,
      cacheCreationTokens: 100
    })).toBe('↓ 1.2k · ↑ 356 · кэш 89.1k')
  })
})

describe('formatDuration — человеческая длительность', () => {
  it('меньше секунды → «<1с»', () => {
    expect(formatDuration(0)).toBe('<1с')
    expect(formatDuration(400)).toBe('<1с')
  })
  it('секунды', () => {
    expect(formatDuration(1000)).toBe('1с')
    expect(formatDuration(8000)).toBe('8с')
    expect(formatDuration(59000)).toBe('59с')
  })
  it('минуты и секунды', () => {
    expect(formatDuration(60000)).toBe('1м')
    expect(formatDuration(80000)).toBe('1м 20с')
  })
})

describe('composerPeek — подпись свёрнутого композера', () => {
  it('черновик важнее всего остального', () => {
    expect(composerPeek('  проверь ран  ', 2, 'thinking')).toBe('проверь ран')
  })

  it('без черновика показывает вложения', () => {
    expect(composerPeek('', 3, 'idle')).toBe('Вложений: 3')
  })

  it('пустой композер в простое зовёт развернуть, в ходе — показывает состояние', () => {
    expect(composerPeek('', 0, 'idle')).toBe('Показать поле ввода')
    expect(composerPeek('', 0, 'listening')).toBe('Идёт запись, говорите')
    expect(composerPeek('', 0, 'thinking', 'Codex')).toBe('Запрос отправлен движку Codex, ждём ответ')
  })
})

describe('clockTime / formatElapsed / messageCost — тайминги и стоимость', () => {
  it('clockTime отдаёт часы:минуты:секунды', () => {
    const ts = Date.UTC(2026, 0, 2, 9, 5, 7)
    // Зависит от пояса зрителя; проверяем формат HH:MM:SS.
    expect(clockTime(ts)).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('formatElapsed — мм:сс, не уходит в минус', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(65_000)).toBe('01:05')
    expect(formatElapsed(-1000)).toBe('00:00')
    expect(formatElapsed(3_599_000)).toBe('59:59')
  })

  it('messageCost: реальная цена из ответа модели показывается как есть', () => {
    const cost = messageCost({ costUsd: 0.1234, model: 'opus' })
    expect(cost).toMatchObject({ estimated: false, text: '$0.12' })
    expect(cost?.title).toMatch(/из ответа модели/)
  })

  it('messageCost: без цены модели — расчётная по тарифам с «≈»', () => {
    const cost = messageCost({ model: 'opus', inputTokens: 1000, outputTokens: 2000 })
    expect(cost?.estimated).toBe(true)
    expect(cost?.text.startsWith('≈ $')).toBe(true)
    expect(cost?.title).toMatch(/по тарифам/)
  })

  it('messageCost: модель неизвестна и цены нет → null', () => {
    expect(messageCost({ inputTokens: 100 })).toBeNull()
  })
})
