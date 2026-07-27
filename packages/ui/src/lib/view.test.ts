import { describe, it, expect } from 'vitest'
import type { ClaudeLogEntry } from '@shared/types'
import { activityLocation, activityStatus, chipClass, formatDuration, formatLiveUsage, messageTime, pluralActions } from './view'

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
