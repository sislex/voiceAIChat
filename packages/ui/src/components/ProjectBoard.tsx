// Страница «Доска проекта»: тонкая обёртка над изолированным KanbanBoard —
// рамка страницы (ToolFrame), кнопка настроек и Esc-семантика «сначала
// закрывается модалка задачи, потом страница». Сама доска ничего не знает про
// приложение — все данные и колбэки идут пропсами насквозь.

import { useEffect, useState } from 'react'
import { IconButton } from './ui/IconButton'
import { ToolFrame } from './ToolFrame'
import { KanbanBoard, type KanbanBoardProps } from './kanban'

export interface ProjectBoardProps extends Omit<KanbanBoardProps, 'openTaskId' | 'onOpenTaskChange' | 'defaultSwimlane'> {
  onOpenSettings?: () => void
  onClose: () => void
  /** Открыть карточку сразу при входе (переход «в задачу» из связанного чата). */
  initialOpenTaskId?: string | null
}

export function ProjectBoard(props: ProjectBoardProps): JSX.Element {
  const { onOpenSettings, onClose, initialOpenTaskId, ...boardProps } = props
  // Esc-хендлеры страницы и модалки оба висят на window (capture), stopPropagation
  // соседей не гасит — поэтому страница сама закрывает модалку первой.
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialOpenTaskId ?? null)
  // Приход из чата: URL несёт задачу, её карточку открываем сразу.
  useEffect(() => {
    if (initialOpenTaskId) setOpenTaskId(initialOpenTaskId)
  }, [initialOpenTaskId])
  return (
    <ToolFrame
      title={props.projectName}
      onClose={() => {
        if (openTaskId) setOpenTaskId(null)
        else onClose()
      }}
      testId="project-board"
      variant="page"
      className="kanban-frame"
      actions={
        onOpenSettings && (
          <IconButton size="sm" className="kanban-settings" aria-label="Настройки проекта" title="Настройки проекта" onClick={onOpenSettings}>
            ⚙ Настройки
          </IconButton>
        )
      }
    >
      <KanbanBoard {...boardProps} openTaskId={openTaskId} onOpenTaskChange={setOpenTaskId} />
    </ToolFrame>
  )
}
