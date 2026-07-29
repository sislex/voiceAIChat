// Страница «Доска проекта»: тонкая обёртка над изолированным KanbanBoard —
// рамка страницы (ToolFrame), кнопка настроек и Esc-семантика «сначала
// закрывается модалка задачи, потом страница». Сама доска ничего не знает про
// приложение — все данные и колбэки идут пропсами насквозь.

import { useState } from 'react'
import { ToolFrame } from './ToolFrame'
import { KanbanBoard, type KanbanBoardProps } from './kanban'

export interface ProjectBoardProps extends Omit<KanbanBoardProps, 'openTaskId' | 'onOpenTaskChange' | 'defaultSwimlane'> {
  onOpenSettings?: () => void
  onClose: () => void
}

export function ProjectBoard(props: ProjectBoardProps): JSX.Element {
  const { onOpenSettings, onClose, ...boardProps } = props
  // Esc-хендлеры страницы и модалки оба висят на window (capture), stopPropagation
  // соседей не гасит — поэтому страница сама закрывает модалку первой.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
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
          <button className="renbtn kanban-settings" title="Настройки проекта" onClick={onOpenSettings}>
            ⚙ Настройки
          </button>
        )
      }
    >
      <KanbanBoard {...boardProps} openTaskId={openTaskId} onOpenTaskChange={setOpenTaskId} />
    </ToolFrame>
  )
}
