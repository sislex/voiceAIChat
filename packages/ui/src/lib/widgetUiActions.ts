// Исполнение действий канбан-ассистента в интерфейсе (кадр widget.action).
// Живёт отдельно от App: набор действий надо проверять тестом, а App и без
// этого длинный. Зависимости инъектируются, поэтому тест обходится без рендера.

import type { WidgetSurfaceSnapshot, WidgetUiAction, WidgetUiActionResult } from '@shared/widgetAssistant'
import type { Command } from './commands'

export interface WidgetUiActionDeps {
  /** Проект, открытый в этой вкладке; null — страницы проекта нет. */
  openProjectId: string | null
  navigate(route: string): void
  /** Снимок экрана — читается после перерисовки, поэтому это функция. */
  surface(): WidgetSurfaceSnapshot | null
  commands(): Command[]
  confirm(request: { title: string; note?: string; rows: Array<{ field: string; before?: unknown; after?: unknown }> }): Promise<boolean>
  /** Дать React перерисоваться после навигации, чтобы снимок был уже новым. */
  settle(): Promise<void>
}

export type WidgetUiActionOutcome =
  | { ok: true; result: WidgetUiActionResult }
  | { ok: false; error: string }

/** Человеческая расшифровка предложенных изменений для окна подтверждения. */
export function formatConfirmRows(rows: Array<{ field: string; before?: unknown; after?: unknown }>): string {
  return rows
    .map((row) => `${row.field}: ${row.before === undefined ? '' : `${describeValue(row.before)} → `}${describeValue(row.after)}`)
    .join('\n')
}

function describeValue(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export async function runWidgetUiAction(
  action: WidgetUiAction,
  projectId: string,
  deps: WidgetUiActionDeps
): Promise<WidgetUiActionOutcome> {
  // Действие выполняет только вкладка с открытым проектом этого разговора:
  // сервер разослал его всем клиентам пользователя и ждёт первый успех.
  if (deps.openProjectId !== projectId) return { ok: false, error: 'Проект ассистента не открыт в этой вкладке.' }
  const settled = async (note: string): Promise<WidgetUiActionOutcome> => {
    await deps.settle()
    return { ok: true, result: { surface: deps.surface(), note } }
  }
  switch (action.kind) {
    case 'read-state':
      return { ok: true, result: { surface: deps.surface() } }
    case 'navigate':
      deps.navigate(action.route)
      return settled(`Открыт адрес ${action.route}`)
    case 'open-task':
      deps.navigate(`/projects/${projectId}/task/${action.taskId}${action.tab ? `/${action.tab}` : ''}`)
      return settled('Карточка открыта')
    case 'close-task':
      deps.navigate(`/projects/${projectId}`)
      return settled('Карточка закрыта')
    case 'run-command': {
      const command = deps.commands().find((item) => item.id === action.commandId)
      if (!command) return { ok: false, error: 'Такой кнопки сейчас нет на экране: перечитай ui_state.' }
      if (command.enabled?.() === false) return { ok: false, error: `Кнопка «${command.title}» сейчас недоступна.` }
      command.run()
      return settled(`Нажато: ${command.title}`)
    }
    case 'confirm': {
      const confirmed = await deps.confirm({ title: action.title, rows: action.rows, ...(action.note ? { note: action.note } : {}) })
      return { ok: true, result: { surface: deps.surface(), confirmed } }
    }
    default:
      return { ok: false, error: 'Неизвестное действие.' }
  }
}
