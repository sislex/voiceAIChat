import { describe, it, expect } from 'vitest'
import { avatarColor, avatarContrast, columnRegionLabel, duePresentation, dueState, emptyColumnPresentation, epicColor, initials, issueKey, projectKey, wipPresentation } from './kanbanMeta'

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

  it('duePresentation различает просрочку, сегодня, завтра и оставшиеся дни', () => {
    const now = new Date(2026, 8, 11, 12).getTime()
    expect(duePresentation(new Date(2026, 8, 8, 9).getTime(), now)).toMatchObject({
      state: 'overdue', short: 'Просрочено 3 дня', days: -3
    })
    expect(duePresentation(new Date(2026, 8, 11, 23).getTime(), now)).toMatchObject({
      state: 'soon', short: 'Сегодня', days: 0
    })
    expect(duePresentation(new Date(2026, 8, 12, 9).getTime(), now)).toMatchObject({
      state: 'soon', short: 'Завтра', days: 1
    })
    expect(duePresentation(new Date(2026, 8, 16, 9).getTime(), now)).toMatchObject({
      state: 'ok', short: 'Через 5 дней', days: 5
    })
    expect(duePresentation(new Date(2026, 8, 16, 9).getTime(), now).label).toContain('16.09.2026')
  })

  it('emptyColumnPresentation различает настоящую пустоту и источник фильтрации', () => {
    expect(emptyColumnPresentation({ columnName: 'Бэклог', total: 0, visible: 0, globallyMatching: 0, globalFiltersActive: false, localFilterActive: false })).toEqual({
      state: 'empty',
      title: '«Бэклог» пока пуста',
      description: 'Создайте первую задачу или перетащите сюда карточку из другой колонки.',
      badge: 'Готова к работе',
      hiddenCount: 0,
      localFilterHidesMatches: false
    })
    expect(emptyColumnPresentation({ columnName: 'Готово', total: 5, visible: 0, globallyMatching: 0, globalFiltersActive: true, localFilterActive: true })).toMatchObject({
      state: 'filtered', badge: 'Скрыто 5 задач', hiddenCount: 5, localFilterHidesMatches: false
    })
    expect(emptyColumnPresentation({ columnName: 'В работе', total: 2, visible: 0, globallyMatching: 1, globalFiltersActive: true, localFilterActive: true })).toMatchObject({
      description: expect.stringContaining('Фильтры доски и исполнителей колонки'),
      localFilterHidesMatches: true
    })
    expect(emptyColumnPresentation({ columnName: 'В работе', total: 1, visible: 1, globallyMatching: 1, globalFiltersActive: false, localFilterActive: false })).toBeNull()
  })

  it('имя колонки для скринридера: название, счёт и признак «скрыта»', () => {
    expect(columnRegionLabel({ name: 'To Do', hidden: false }, 1)).toBe('Колонка «To Do», 1 задача')
    expect(columnRegionLabel({ name: 'To Do', hidden: false }, 3)).toBe('Колонка «To Do», 3 задачи')
    expect(columnRegionLabel({ name: 'To Do', hidden: false }, 11)).toBe('Колонка «To Do», 11 задач')
    expect(columnRegionLabel({ name: 'To Do', hidden: false }, 0)).toBe('Колонка «To Do», задач нет')
    expect(columnRegionLabel({ name: 'Архив', hidden: true }, 2)).toBe('Колонка «Архив», 2 задачи, скрыта')
  })

  it('WIP различает свободную ёмкость, предел и точное превышение', () => {
    expect(wipPresentation(1, 3)).toEqual({
      state: 'available', percentage: 33, progressValue: 1,
      label: 'WIP: 1 из 3, свободно 2 места'
    })
    expect(wipPresentation(3, 3)).toEqual({
      state: 'full', percentage: 100, progressValue: 3,
      label: 'WIP-лимит заполнен: 3 из 3'
    })
    expect(wipPresentation(5, 3)).toEqual({
      state: 'over', percentage: 100, progressValue: 3,
      label: 'WIP-лимит превышен: 5 из 3, превышение на 2 задачи'
    })
    expect(wipPresentation(2, null)).toBeNull()
    expect(wipPresentation(2, 0)).toBeNull()
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
