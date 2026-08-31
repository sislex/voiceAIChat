import { describe, expect, it } from 'vitest'
import { isAllowedWidgetRoute } from './widgetAssistant'

describe('isAllowedWidgetRoute', () => {
  it('разрешает страницу своего проекта и её подпути', () => {
    expect(isAllowedWidgetRoute('/projects/p1', 'p1')).toBe(true)
    expect(isAllowedWidgetRoute('/projects/p1/settings', 'p1')).toBe(true)
    expect(isAllowedWidgetRoute('/projects/p1/task/t2/preparation', 'p1')).toBe(true)
    expect(isAllowedWidgetRoute('#/projects/p1/releases', 'p1')).toBe(true)
  })

  it('не выпускает ассистента в чужой проект и в другие разделы приложения', () => {
    expect(isAllowedWidgetRoute('/projects/p2', 'p1')).toBe(false)
    // Префикс совпадает по строке, но это другой проект.
    expect(isAllowedWidgetRoute('/projects/p10', 'p1')).toBe(false)
    expect(isAllowedWidgetRoute('/admin', 'p1')).toBe(false)
    expect(isAllowedWidgetRoute('/chat/c1', 'p1')).toBe(false)
  })

  it('разрешает общую базу знаний', () => {
    expect(isAllowedWidgetRoute('/kb', 'p1')).toBe(true)
    expect(isAllowedWidgetRoute('/kb/doc-1', 'p1')).toBe(true)
  })

  it('отклоняет относительные адреса и обход вверх', () => {
    expect(isAllowedWidgetRoute('projects/p1', 'p1')).toBe(false)
    expect(isAllowedWidgetRoute('/projects/p1/../admin', 'p1')).toBe(false)
    expect(isAllowedWidgetRoute('', 'p1')).toBe(false)
  })
})
