import { describe, expect, it, vi } from 'vitest'
import type { WidgetSurfaceSnapshot } from '@shared/widgetAssistant'
import { formatConfirmRows, runWidgetUiAction, type WidgetUiActionDeps } from './widgetUiActions'

const SURFACE: WidgetSurfaceSnapshot = {
  route: '/projects/p1',
  section: 'board',
  openTaskId: null,
  openTaskTab: null,
  boardView: null,
  commands: []
}

function deps(overrides: Partial<WidgetUiActionDeps> = {}): WidgetUiActionDeps {
  return {
    openProjectId: 'p1',
    navigate: vi.fn(),
    surface: () => SURFACE,
    commands: () => [],
    confirm: async () => true,
    settle: async () => {},
    ...overrides
  }
}

describe('runWidgetUiAction', () => {
  it('вкладка без нужного проекта отказывается выполнять действие', async () => {
    const navigate = vi.fn()
    const outcome = await runWidgetUiAction({ kind: 'read-state' }, 'p1', deps({ openProjectId: 'p2', navigate }))
    expect(outcome).toEqual({ ok: false, error: 'Проект ассистента не открыт в этой вкладке.' })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('навигация уводит по адресу и возвращает снимок экрана', async () => {
    const navigate = vi.fn()
    const outcome = await runWidgetUiAction({ kind: 'navigate', route: '/projects/p1/settings' }, 'p1', deps({ navigate }))
    expect(navigate).toHaveBeenCalledWith('/projects/p1/settings')
    expect(outcome).toMatchObject({ ok: true, result: { surface: SURFACE } })
  })

  it('открытие и закрытие карточки строят проектный маршрут', async () => {
    const navigate = vi.fn()
    await runWidgetUiAction({ kind: 'open-task', taskId: 't1', tab: 'preparation' }, 'p1', deps({ navigate }))
    expect(navigate).toHaveBeenCalledWith('/projects/p1/task/t1/preparation')
    await runWidgetUiAction({ kind: 'close-task' }, 'p1', deps({ navigate }))
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1')
  })

  it('нажимает команду реестра, а недоступную и несуществующую отклоняет', async () => {
    const run = vi.fn()
    const commands = () => [
      { id: 'task.create', title: 'Создать задачу', section: 'action' as const, run },
      { id: 'ci.retry', title: 'Повторить ран', section: 'action' as const, run: vi.fn(), enabled: () => false }
    ]
    const ok = await runWidgetUiAction({ kind: 'run-command', commandId: 'task.create' }, 'p1', deps({ commands }))
    expect(run).toHaveBeenCalled()
    expect(ok).toMatchObject({ ok: true, result: { note: 'Нажато: Создать задачу' } })

    const disabled = await runWidgetUiAction({ kind: 'run-command', commandId: 'ci.retry' }, 'p1', deps({ commands }))
    expect(disabled).toEqual({ ok: false, error: 'Кнопка «Повторить ран» сейчас недоступна.' })

    const missing = await runWidgetUiAction({ kind: 'run-command', commandId: 'nope' }, 'p1', deps({ commands }))
    expect(missing.ok).toBe(false)
  })

  it('подтверждение возвращает решение пользователя, а не ошибку', async () => {
    const declined = await runWidgetUiAction(
      { kind: 'confirm', title: 'Изменить настройки', rows: [{ field: 'name', before: 'A', after: 'B' }] },
      'p1',
      deps({ confirm: async () => false })
    )
    expect(declined).toMatchObject({ ok: true, result: { confirmed: false } })
  })
})

describe('formatConfirmRows', () => {
  it('показывает переход «было → стало» и пустые значения прочерком', () => {
    expect(formatConfirmRows([
      { field: 'title', before: 'Старое', after: 'Новое' },
      { field: 'columnId', after: 'col-1' },
      { field: 'labels', before: [], after: ['bug', 'ui'] },
      { field: 'assignee', before: 'ann', after: null }
    ])).toBe('title: Старое → Новое\ncolumnId: col-1\nlabels: — → bug, ui\nassignee: ann → —')
  })
})
