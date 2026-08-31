// Модель навигации Operations. Проверяется то, что пользователь видит как
// «подсветился не тот пункт»: активность считается сравнением разобранного
// адреса с маршрутом пункта, и у раздела «База знаний» правило нарочно другое —
// он остаётся активным и на карточке отдельного документа.

import { describe, expect, it } from 'vitest'
import { createOperationsNavigationModel } from './navigation'
import { buildOperationsRoute } from './routes'

const authed = { authenticated: true }
const ids = (hash: string, context = authed) => createOperationsNavigationModel(hash, context).filter((item) => item.active).map((item) => item.id)

describe('createOperationsNavigationModel', () => {
  it('перечисляет все разделы в постоянном порядке', () => {
    expect(createOperationsNavigationModel('#/machines', authed).map((item) => item.id))
      .toEqual(['machines', 'claude', 'codex', 'kb', 'ci'])
  })

  it('маршрут пункта совпадает с тем, что строит buildOperationsRoute', () => {
    const model = createOperationsNavigationModel('#/machines', authed)
    expect(model.find((item) => item.id === 'machines')?.route).toBe(buildOperationsRoute({ page: 'machines' }))
    expect(model.find((item) => item.id === 'claude')?.route).toBe(buildOperationsRoute({ page: 'history', engine: 'claude' }))
    expect(model.find((item) => item.id === 'codex')?.route).toBe(buildOperationsRoute({ page: 'history', engine: 'codex' }))
    expect(model.find((item) => item.id === 'ci')?.route).toBe(buildOperationsRoute({ page: 'ci' }))
    expect(model.find((item) => item.id === 'kb')?.route).toBe(buildOperationsRoute({ page: 'knowledge' }))
  })

  it('активен ровно один пункт на каждый известный адрес', () => {
    expect(ids('#/machines')).toEqual(['machines'])
    expect(ids('#/claude-code')).toEqual(['claude'])
    expect(ids('#/codex')).toEqual(['codex'])
    expect(ids('#/ci')).toEqual(['ci'])
    expect(ids('#/kb')).toEqual(['kb'])
  })

  it('движки Claude и Codex не подсвечиваются одновременно', () => {
    // Оба — page: 'history', различает только engine; сравнение по объекту целиком.
    expect(ids('#/claude-code')).not.toContain('codex')
    expect(ids('#/codex')).not.toContain('claude')
  })

  it('«База знаний» остаётся активной на карточке документа', () => {
    // У неё правило по page, а не по маршруту целиком: адрес документа другой,
    // а раздел тот же.
    expect(ids('#/kb/testing-operations')).toEqual(['kb'])
  })

  it('неизвестный адрес не подсвечивает ничего', () => {
    expect(ids('#/что-то-чужое')).toEqual([])
  })

  it('без аутентификации не показывается ни один пункт', () => {
    const model = createOperationsNavigationModel('#/machines', { authenticated: false })
    expect(model.every((item) => item.visible === false)).toBe(true)
    // Активность при этом считается по-прежнему — скрытый пункт остаётся собой.
    expect(model.find((item) => item.id === 'machines')?.active).toBe(true)
  })

  it('у каждого пункта есть человеческая подпись', () => {
    const model = createOperationsNavigationModel('#/machines', authed)
    expect(model.map((item) => item.label)).toEqual(['Машины', 'Claude Code', 'Codex', 'База знаний', 'CI'])
  })
})
