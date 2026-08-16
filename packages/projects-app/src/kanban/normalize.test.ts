import { describe, it, expect } from 'vitest'
import type { Board, KanbanColumn, Task } from '@shared/projects'
import { normalizeBoard, normalizeColumn, normalizeTask } from './normalize'

const base: Task = {
  id: 't1', projectId: 'p1', columnId: 'c1', type: 'task', parentId: null, title: 'T', description: '',
  acceptanceCriteria: '', priority: 'medium', assignee: null, labels: [], skills: [], storyPoints: null, dueDate: null,

  flagged: false, seq: 1, position: 1024, createdAt: 1, updatedAt: 1
}

describe('normalize', () => {
  it('битые поля задачи заменяются безопасными значениями', () => {
    const raw = {
      ...base,
      title: '  ',
      labels: undefined,
      priority: 'критический',
      type: 'bug',
      parentId: 42,
      assignee: '',
      storyPoints: -3,
      dueDate: 'завтра',
      flagged: 'yes',
      seq: undefined,
      position: 'top'
    } as unknown as Task
    const t = normalizeTask(raw)
    expect(t.title).toBe('(без названия)')
    expect(t.labels).toEqual([])
    expect(t.priority).toBe('medium')
    expect(t.type).toBe('task')
    expect(t.parentId).toBeNull()
    expect(t.assignee).toBeNull()
    expect(t.storyPoints).toBeNull()
    expect(t.dueDate).toBeNull()
    expect(t.flagged).toBe(false)
    expect(t.seq).toBe(0)
    expect(t.position).toBe(0)
  })

  it('валидная задача проходит без изменений', () => {
    const t = normalizeTask({ ...base, labels: ['ui'], storyPoints: 3, dueDate: 5, flagged: true })
    expect(t).toEqual({ ...base, labels: ['ui'], storyPoints: 3, dueDate: 5, flagged: true })
  })

  it('wipLimit колонки: не положительное число → null', () => {
    const col: KanbanColumn = { id: 'c1', projectId: 'p1', name: 'A', semanticType: 'custom', position: 1, hidden: false, wipLimit: 5, createdAt: 1 }
    expect(normalizeColumn(col).wipLimit).toBe(5)
    expect(normalizeColumn({ ...col, wipLimit: -5 }).wipLimit).toBeNull()
    expect(normalizeColumn({ ...col, wipLimit: 0 }).wipLimit).toBeNull()
    expect(normalizeColumn({ ...col, wipLimit: 'ten' as unknown as number }).wipLimit).toBeNull()
    expect(normalizeColumn({ ...col, name: '' }).name).toBe('(колонка)')
  })

  it('normalizeBoard: null насквозь, не-массивы → пустые', () => {
    expect(normalizeBoard(null)).toBeNull()
    const b = normalizeBoard({ columns: undefined, tasks: undefined } as unknown as Board)
    expect(b?.columns).toEqual([])
    expect(b?.tasks).toEqual([])
  })
})
