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
  initialOpenTaskTab?: 'preparation' | 'feed'
  onOpenTaskRouteChange?: (taskId: string | null, tab?: 'preparation' | 'feed') => void
  onAssistantSelectionChange?: (taskId: string | null, field: Parameters<NonNullable<KanbanBoardProps['onSelectedFieldChange']>>[0]) => void
}

export function ProjectBoard(props: ProjectBoardProps): JSX.Element {
  const { initialOpenTaskId, initialOpenTaskTab, onOpenTaskRouteChange, onAssistantSelectionChange, ...boardProps } = props
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialOpenTaskId ?? null)
  const [openTaskTab, setOpenTaskTab] = useState<'preparation' | 'feed' | undefined>(initialOpenTaskTab)
  const [selectedField, setSelectedField] = useState<Parameters<NonNullable<KanbanBoardProps['onSelectedFieldChange']>>[0]>(null)
  // Приход из чата: URL несёт задачу, её карточку открываем сразу.
  useEffect(() => {
    if (initialOpenTaskId) { setOpenTaskId(initialOpenTaskId); setOpenTaskTab(initialOpenTaskTab) }
  }, [initialOpenTaskId, initialOpenTaskTab])
  useEffect(() => { onAssistantSelectionChange?.(openTaskId, selectedField) }, [openTaskId, selectedField, onAssistantSelectionChange])
  return <KanbanBoard {...boardProps} openTaskId={openTaskId} initialOpenTaskTab={openTaskTab} onOpenTaskChange={(taskId, tab) => { setOpenTaskId(taskId); setOpenTaskTab(tab); onOpenTaskRouteChange?.(taskId, tab) }} onSelectedFieldChange={setSelectedField} />
}
