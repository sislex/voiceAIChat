import { describe, it, expect, vi } from 'vitest'
import { createVoiceStore, type VoiceStore } from './voiceStore'
import { createFakeApi, type FakeApi } from '../test/fakeApi'

function makeStore(): { store: VoiceStore; api: FakeApi } {
  const api = createFakeApi()
  const store = createVoiceStore({ api, now: () => 1_700_000_000_000 })
  return { store, api }
}

describe('voiceStore — проекты и доска', () => {
  it('createProject наполняет список и панель деталей', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1', technologies: ['ts'] })
    expect(store.getState().projects.map((p) => p.name)).toContain('P1')
    expect(store.getState().projectDetail?.name).toBe('P1')
    expect(store.getState().projectDetail?.role).toBe('owner')
  })

  it('openBoard грузит доску с дефолтными колонками', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    expect(store.getState().activeProjectId).toBe(id)
    expect(store.getState().board?.columns.map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Done'])
  })

  it('createColumn и createTask отражаются в board', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    await store.actions.createColumn('Review')
    expect(store.getState().board!.columns.map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Done', 'Review'])
    const todo = store.getState().board!.columns[0]
    await store.actions.createTask(todo.id, { title: 'Задача A' })
    expect(store.getState().board!.tasks.map((t) => t.title)).toContain('Задача A')
  })

  it('moveTask оптимистично меняет колонку и зовёт tasks:move', async () => {
    const { store, api } = makeStore()
    const spy = vi.spyOn(api, 'tasks:move')
    await store.actions.createProject({ name: 'P1' })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    const [todo, doing] = store.getState().board!.columns
    await store.actions.createTask(todo.id, { title: 'A' })
    const taskA = store.getState().board!.tasks.find((t) => t.title === 'A')!
    await store.actions.moveTask(taskA.id, doing.id, null, null)
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: taskA.id, columnId: doing.id })
    )
    expect(store.getState().board!.tasks.find((t) => t.id === taskA.id)!.columnId).toBe(doing.id)
  })

  it('applyBoardUpdate заменяет доску только активного проекта', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    store.actions.applyBoardUpdate('other', { columns: [], tasks: [] })
    expect(store.getState().board!.columns.length).toBeGreaterThan(0) // чужой — игнор
    store.actions.applyBoardUpdate(id, { columns: [], tasks: [] })
    expect(store.getState().board!.columns).toEqual([])
  })

  it('closeProjects сбрасывает состояние проектов и доски', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    store.actions.closeProjects()
    const s = store.getState()
    expect(s.projectsOpen).toBe(false)
    expect(s.activeProjectId).toBeNull()
    expect(s.board).toBeNull()
    expect(s.projectDetail).toBeNull()
  })
})
