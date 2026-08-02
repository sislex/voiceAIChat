import { describe, it, expect } from 'vitest'
import { DEFAULT_DONE_RETENTION_DAYS, isCompletedHidden, issueKey, projectKey } from './projects'

const DAY = 24 * 60 * 60 * 1000
const T0 = 1_700_000_000_000

describe('isCompletedHidden — когда завершённая задача уходит с доски', () => {
  it('незавершённая задача не скрывается никогда', () => {
    expect(isCompletedHidden(null, 0, T0)).toBe(false)
    expect(isCompletedHidden(undefined, 14, T0 + 999 * DAY)).toBe(false)
  })

  it('пустой порог — не скрывать', () => {
    expect(isCompletedHidden(T0, null, T0 + 999 * DAY)).toBe(false)
    expect(isCompletedHidden(T0, undefined, T0 + 999 * DAY)).toBe(false)
  })

  it('порог 0 — убрать в конце дня, а не в ту же секунду', () => {
    // Карточку в «Готово» переносит и CI-раннер после успешного мержа: исчезнуть
    // мгновенно она не имеет права — иначе работа пропадает с доски без следа.
    const endOfDay = new Date(T0).setHours(24, 0, 0, 0)
    expect(isCompletedHidden(T0, 0, T0)).toBe(false)
    expect(isCompletedHidden(T0, 0, endOfDay - 1)).toBe(false)
    expect(isCompletedHidden(T0, 0, endOfDay)).toBe(true)
  })

  it('дефолтные 14 дней: на 13-й день видна, на 14-й уже нет', () => {
    expect(DEFAULT_DONE_RETENTION_DAYS).toBe(14)
    expect(isCompletedHidden(T0, DEFAULT_DONE_RETENTION_DAYS, T0 + 13 * DAY)).toBe(false)
    expect(isCompletedHidden(T0, DEFAULT_DONE_RETENTION_DAYS, T0 + 14 * DAY)).toBe(true)
  })

  it('мусорный порог читается как «не скрывать»', () => {
    expect(isCompletedHidden(T0, Number.NaN, T0 + 999 * DAY)).toBe(false)
    expect(isCompletedHidden(T0, -1, T0 + 999 * DAY)).toBe(false)
  })
})

describe('ключ задачи', () => {
  it('строится из имени проекта и номера', () => {
    expect(projectKey('Voice Chat')).toBe('VC')
    expect(issueKey('Voice Chat', { seq: 42 })).toBe('VC-42')
  })
})
