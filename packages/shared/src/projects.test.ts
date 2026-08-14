import { describe, it, expect } from 'vitest'
import { canTransitionWorkflow, compareTasksInColumn, DEFAULT_DONE_RETENTION_DAYS, isCompletedHidden, issueKey, normalizeAcceptanceCriteria, projectKey, QA_WORKFLOW } from './projects'
import { queryWidgetItems } from './widgetAssistant'

const DAY = 24 * 60 * 60 * 1000
const T0 = 1_700_000_000_000

describe('QA workflow semantics', () => {
  it('keeps the canonical sequence independent of display names', () => {
    expect(QA_WORKFLOW).toEqual([
      'backlog', 'preparation', 'ready', 'development', 'component_qa',
      'integration_tests', 'automated_qa', 'manual_qa', 'awaiting_merge', 'done'
    ])
  })
  it('requires a user decision to leave decision_required', () => {
    expect(canTransitionWorkflow('decision_required', 'development', 'automation')).toBe(false)
    expect(canTransitionWorkflow('decision_required', 'development', 'user')).toBe(true)
    expect(canTransitionWorkflow('backlog', 'development', 'user')).toBe(false)
  })
})

describe('normalizeAcceptanceCriteria', () => {
  it('нумерует непустые абзацы и нормализует старые номера', () => {
    expect(normalizeAcceptanceCriteria('Первый\n\n7. Второй\n7) Третий')).toBe(
      '1. Первый\n2. Второй\n3. Третий'
    )
  })

  it('идемпотентна и не превращает вложенное Markdown-содержимое в критерии', () => {
    const markdown = [
      '1. Критерий со справкой',
      '   - вложенный пункт',
      '   > цитата',
      '   ```ts',
      '   const ok = true',
      '   ```',
      '2. Следующий'
    ].join('\n')
    expect(normalizeAcceptanceCriteria(markdown)).toBe(markdown)
    expect(normalizeAcceptanceCriteria(normalizeAcceptanceCriteria(markdown))).toBe(markdown)
  })

  it('убирает номера и checkbox-маркеры из вставленного текста', () => {
    expect(normalizeAcceptanceCriteria('1. 4. Первый\n- [ ] Второй')).toBe('1. Первый\n2. Второй')
  })
})

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

describe('порядок задач в колонке', () => {
  const task = (id: string, doneAt: number | null, position: number) => ({ id, doneAt, position, createdAt: 1 })

  it('в done сортирует по времени входа, а fallback без метки стабилен', () => {
    expect([
      task('old', 10, 1024),
      task('new', 20, 2048),
      task('legacy-b', null, 2048),
      task('legacy-a', null, 1024)
    ].sort((a, b) => compareTasksInColumn(a, b, 'done')).map((item) => item.id))
      .toEqual(['new', 'old', 'legacy-a', 'legacy-b'])
  })

  it('в development сортирует по убыванию приоритета и стабильно сохраняет ручной порядок', () => {
    const withPriority = (id: string, priority: 'low' | 'medium' | 'high' | 'urgent', position: number) =>
      ({ ...task(id, null, position), priority })
    expect([
      withPriority('low', 'low', 1024),
      withPriority('high-late', 'high', 2048),
      withPriority('urgent', 'urgent', 4096),
      withPriority('high-early', 'high', 1024)
    ].sort((a, b) => compareTasksInColumn(a, b, 'development')).map((item) => item.id))
      .toEqual(['urgent', 'high-early', 'high-late', 'low'])
  })

  it('в остальных колонках сохраняет ручной порядок', () => {
    expect([task('late', 20, 2048), task('early', 10, 1024)]
      .sort((a, b) => compareTasksInColumn(a, b, 'testing')).map((item) => item.id))
      .toEqual(['early', 'late'])
  })
})

describe('ключ задачи', () => {
  it('строится из имени проекта и номера', () => {
    expect(projectKey('Voice Chat')).toBe('VC')
    expect(issueKey('Voice Chat', { seq: 42 })).toBe('VC-42')
  })
})

describe('widget query contract', () => {
  it('ищет семантические элементы, фильтрует kind и ограничивает выдачу', () => {
    const items = [
      { id: 'e1', kind: 'epic', title: 'UI', version: '1', data: { description: 'Интерфейс' } },
      { id: 't1', kind: 'task', title: 'API', version: '2', data: { labels: ['ui'] } }
    ]
    expect(queryWidgetItems(items, 'ui', ['epic'], 10).map((item) => item.id)).toEqual(['e1'])
    expect(queryWidgetItems(items, 'интерфейс', [], 1).map((item) => item.id)).toEqual(['e1'])
  })
})
