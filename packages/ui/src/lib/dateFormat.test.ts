import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, isoDate } from './dateFormat'

describe('формат дат', () => {
  const moment = Date.parse('2026-08-29T01:38:00Z')

  it('день и месяц не путаются местами', () => {
    // Ровно та причина, по которой хелпер появился: `8/29/2026` в русском
    // интерфейсе читается двусмысленно.
    expect(formatDate(moment)).toBe('29.08.2026')
    expect(formatDateTime(moment)).toMatch(/^29\.08\.2026, \d{2}:\d{2}$/)
  })

  it('принимает число, строку и Date одинаково', () => {
    expect(formatDate('2026-08-29T01:38:00Z')).toBe('29.08.2026')
    expect(formatDate(new Date(moment))).toBe('29.08.2026')
  })

  it('отсутствие момента даёт «—», а не «Invalid Date»', () => {
    for (const value of [null, undefined, '', Number.NaN, 'не дата']) {
      expect(formatDate(value as never), String(value)).toBe('—')
      expect(formatDateTime(value as never), String(value)).toBe('—')
    }
    expect(isoDate(null)).toBe('')
  })

  it('isoDate годится для атрибута time', () => {
    expect(isoDate(moment)).toBe('2026-08-29T01:38:00.000Z')
  })
})
