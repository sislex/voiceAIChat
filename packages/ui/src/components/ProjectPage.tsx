// Страница проекта: одна общая шапка (имя проекта + переключатель разделов) и
// переключаемое содержимое — канбан (`ProjectBoard`) или настройки
// (`ProjectSettings`). Раздел выводится из маршрута, клик по вкладке навигирует;
// сами разделы своей рамки не рисуют и живут внутри этой.
//
// Крестика в шапке нет намеренно: страница проекта — не всплывающий тул, из неё
// уходят навигацией (сайдбар, «Назад»), поэтому `onClose` в `ToolFrame` не
// передаётся. Тогда Esc над открытой карточкой задачи достаётся самой карточке
// через общий стек окон (TaskModal → PopupFrame), а не закрывает страницу.

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { ErrorState } from './ui/ErrorState'
import { EmptyState } from './ui/EmptyState'
import { ToolFrame } from './ToolFrame'
import { SidebarToggle } from './ui/IconButton'

/** Раздел страницы проекта — он же вкладка в шапке. */
export type ProjectSection = 'board' | 'releases' | 'settings'

const SECTIONS: readonly { id: ProjectSection; label: string }[] = [
  { id: 'board', label: 'Канбан' },
  { id: 'releases', label: 'Релизы' },
  { id: 'settings', label: 'Настройки' }
]

export interface ProjectPageProps {
  /** Имя проекта — заголовок шапки. */
  projectName: string
  /** Активный раздел (из маршрута). */
  section: ProjectSection
  /** Клик по вкладке: навигация, а не локальное состояние. */
  onSectionChange: (section: ProjectSection) => void
  /** Показать/скрыть общий Sidebar. */
  onToggleSidebar?: () => void
  /** Фактическое состояние Sidebar для aria-expanded. */
  sidebarExpanded?: boolean
  /** Отдать Esc открытому мобильному Sidebar раньше рамки страницы. */
  onSidebarEscape?: () => boolean
  /** Содержимое активного раздела. */
  children: ReactNode
  assistantOpen?: boolean
  onAssistantOpenChange?: (open: boolean) => void
  onOpenAssistantPage?: () => void
}

export function ProjectPage({ projectName, section, onSectionChange, onToggleSidebar, sidebarExpanded = true, onSidebarEscape, children, assistantOpen = false, onAssistantOpenChange, onOpenAssistantPage }: ProjectPageProps): JSX.Element {
  const tabsRef = useRef<HTMLDivElement>(null)
  // Стрелки переключают вкладку сразу (automatic activation в терминах ARIA).
  // Фокус переносим руками: активная вкладка единственная в tab-порядке
  // (roving tabindex), иначе после стрелки фокус остался бы на невыбранной.
  useEffect(() => {
    const root = tabsRef.current
    if (!root || !root.contains(document.activeElement)) return
    root.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
  }, [section])
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const at = SECTIONS.findIndex((s) => s.id === section)
    const next = SECTIONS[(at + step + SECTIONS.length) % SECTIONS.length]
    if (next && next.id !== section) onSectionChange(next.id)
  }

  return (
    <ToolFrame
      title={projectName}
      variant="page"
      testId="project-page"
      className="projpage"
      onEscape={onSidebarEscape}
      leading={onToggleSidebar ? <SidebarToggle className="proj-sidebar-toggle" expanded={sidebarExpanded} onToggle={onToggleSidebar} /> : undefined}
      actions={
        <>
          {section === 'board' && onAssistantOpenChange && <button type="button" className="vc-btn vc-btn--secondary project-assistant-toggle" aria-pressed={assistantOpen} onClick={() => onAssistantOpenChange(!assistantOpen)}>✦ Ассистент</button>}
          {section === 'board' && assistantOpen && onOpenAssistantPage && <button type="button" className="vc-btn vc-btn--secondary" aria-label="Открыть виджет с ассистентом отдельной страницей" onClick={onOpenAssistantPage}>↗</button>}
          <div
          className="sideswitch projtabs"
          role="tablist"
          aria-label="Разделы проекта"
          ref={tabsRef}
          onKeyDown={onTabsKeyDown}
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={section === s.id}
              tabIndex={section === s.id ? 0 : -1}
              className={section === s.id ? 'on' : ''}
              onClick={() => {
                if (s.id !== section) onSectionChange(s.id)
              }}
            >
              {s.label}
            </button>
          ))}
          </div>
        </>
      }
    >
      {children}
    </ToolFrame>
  )
}

/**
 * Проектов нет вообще. Формы создания на странице нет — проект создаётся в
 * сайдбаре, поэтому подсказка ведёт туда.
 */
export function ProjectsEmptyPage(): JSX.Element {
  return (
    <ToolFrame title="Проекты" variant="page" testId="projects-empty">
      <div className="proj-page-state">
        <EmptyState
          icon="🗂"
          title="Проектов пока нет"
          description="Создайте первый в сайдбаре — кнопка «+ Проект». Внутри проекта появятся доска, задачи и CI."
        />
      </div>
    </ToolFrame>
  )
}

/**
 * id из адреса не нашёлся в списке доступных: проект удалён или к нему нет
 * доступа. Пустая доска в этом случае читалась бы как поломка.
 */
export function ProjectNotFoundPage(): JSX.Element {
  return (
    <ToolFrame title="Проект" variant="page" testId="project-not-found">
      <div className="proj-page-state">
        <ErrorState message="Проект не найден: возможно, он удалён или у вас нет доступа. Выберите проект в сайдбаре." />
      </div>
    </ToolFrame>
  )
}
