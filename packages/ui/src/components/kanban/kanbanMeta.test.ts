import { describe, it, expect } from 'vitest'
import { avatarColor, avatarContrast, columnRegionLabel, dueState, epicColor, initials, issueKey, projectKey } from './kanbanMeta'

describe('kanbanMeta', () => {
  it('projectKey: латиница из инициалов слов, кириллица транслитерируется', () => {
    expect(projectKey('Voice Chat')).toBe('VC')
    expect(projectKey('ChatAI')).toBe('CHAT')
    expect(projectKey('Голос Чат')).toBe('GC')
    expect(projectKey('')).toBe('PRJ')
    expect(projectKey('!!!')).toBe('PRJ')
  })

  it('issueKey соединяет ключ проекта и номер', () => {
    expect(issueKey('Voice Chat', { seq: 42 })).toBe('VC-42')
    expect(issueKey('Voice Chat', { seq: 0 })).toBe('VC-?')
  })

  it('dueState: просрочен / скоро / ок', () => {
    const now = new Date(2026, 6, 28, 12).getTime()
    const day = 24 * 60 * 60 * 1000
    expect(dueState(now - 2 * day, now)).toBe('overdue')
    expect(dueState(now + day / 2, now)).toBe('soon')
    expect(dueState(now + 10 * day, now)).toBe('ok')
  })

  it('имя колонки для скринридера: название, счёт и признак «скрыта»', () => {
    expect(columnRegionLabel({ name: 'To Do', hidden: false }, 1)).toBe('Колонка «To Do», 1 задача')
    expect(columnRegionLabel({ name: 'To Do', hidden: false }, 3)).toBe('Колонка «To Do», 3 задачи')
    expect(columnRegionLabel({ name: 'To Do', hidden: false }, 11)).toBe('Колонка «To Do», 11 задач')
    expect(columnRegionLabel({ name: 'To Do', hidden: false }, 0)).toBe('Колонка «To Do», задач нет')
    expect(columnRegionLabel({ name: 'Архив', hidden: true }, 2)).toBe('Колонка «Архив», 2 задачи, скрыта')
  })

  it('инициалы и стабильные цвета', () => {
    expect(initials('alex')).toBe('AL')
    expect(initials('alex.rozhnov')).toBe('AR')
    expect(epicColor('e1')).toBe(epicColor('e1'))
  })
})

describe('avatarColor', () => {
  // Белая подпись на сгенерированном фоне: при общей светлоте 42% зелёные тона
  // давали 3.06:1 при норме AA 4.5:1 — axe ловил это на реальной доске.
  it('держит AA-контраст с белой подписью на всех тонах', () => {
    for (let hue = 0; hue < 360; hue += 1) {
      const lightness = Number(/(\d+)%\)$/.exec(avatarColor(`user-${hue}`))?.[1] ?? '0')
      expect(avatarContrast(Number(/hsl\((\d+)/.exec(avatarColor(`user-${hue}`))?.[1] ?? '0'), lightness)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('один и тот же логин всегда даёт один цвет', () => {
    expect(avatarColor('bob')).toBe(avatarColor('bob'))
    expect(avatarColor('bob')).not.toBe(avatarColor('alice'))
  })
})
