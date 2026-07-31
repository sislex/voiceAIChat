// Раздел «Канбан» страницы проекта: тонкая обёртка над изолированным
// KanbanBoard. Держит открытую карточку задачи (в том числе приход по ссылке
// «Открыть задачу» из связанного чата) и пробрасывает остальное насквозь — сама
// доска ничего не знает про приложение.
//
// Рамку страницы и переключатель разделов рисует ProjectPage, поэтому своей
// ToolFrame здесь нет: Esc над открытой карточкой закрывает карточку через общий
// стек окон, а страница остаётся открытой.

import { useEffect, useState } from 'react'
import { KanbanBoard, type KanbanBoardProps } from './kanban'

export interface ProjectBoardProps extends Omit<KanbanBoardProps, 'openTaskId' | 'onOpenTaskChange' | 'defaultSwimlane'> {
  /** Открыть карточку сразу при входе (переход «в задачу» из связанного чата). */
  initialOpenTaskId?: string | null
}

export function ProjectBoard(props: ProjectBoardProps): JSX.Element {
  const { initialOpenTaskId, ...boardProps } = props
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialOpenTaskId ?? null)
  // Приход из чата: URL несёт задачу, её карточку открываем сразу.
  useEffect(() => {
    if (initialOpenTaskId) setOpenTaskId(initialOpenTaskId)
  }, [initialOpenTaskId])
  return <KanbanBoard {...boardProps} openTaskId={openTaskId} onOpenTaskChange={setOpenTaskId} />
}
