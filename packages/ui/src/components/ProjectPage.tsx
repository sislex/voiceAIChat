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
import { ErrorState } from '@voicechat/ui-kit'
import { EmptyState } from '@voicechat/ui-kit'
import type { ProjectFeature, ProjectFeatureSet } from '@shared/projectTypes'
import { ToolFrame } from './ToolFrame'
import { SidebarToggle } from './ui/IconButton'

/** Раздел страницы проекта — он же вкладка в шапке. */
export type ProjectSection = 'board' | 'releases' | 'settings'

/**
 * Раздел может требовать возможности типа проекта. «Релизы» бессмысленны там, где
 * тип их выключил, и сервер такие запросы всё равно отклоняет (409).
 */
const SECTIONS: readonly { id: ProjectSection; label: string; feature?: ProjectFeature }[] = [
  { id: 'board', label: 'Канбан' },
  { id: 'releases', label: 'Релизы', feature: 'releases' },
  { id: 'settings', label: 'Настройки' }
]

/** Разделы, доступные при данном наборе возможностей. */
export function visibleProjectSections(features?: ProjectFeatureSet): readonly { id: ProjectSection; label: string }[] {
  return SECTIONS.filter((section) => !section.feature || !features || features[section.feature])
}

export interface ProjectPageProps {
  /** Имя проекта — заголовок шапки. */
  projectName: string
  /** Активный раздел (из маршрута). */
  section: ProjectSection
  /**
   * Эффективные возможности типа проекта. Не передан — показываем всё: страница
   * используется и там, где типа ещё нет (заглушки, витрина).
   */
  features?: ProjectFeatureSet
  /**
   * Ярлык типа рядом с именем. Без него при переходе между проектами непонятно,
   * почему у одного нет «Релизов», а у другого есть.
   */
  typeLabel?: string
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

export function ProjectPage({ projectName, section, features, typeLabel, onSectionChange, onToggleSidebar, sidebarExpanded = true, onSidebarEscape, children, assistantOpen = false, onAssistantOpenChange, onOpenAssistantPage }: ProjectPageProps): JSX.Element {
  const tabsRef = useRef<HTMLDivElement>(null)
  const sections = visibleProjectSections(features)
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
    const at = sections.findIndex((s) => s.id === section)
    const next = sections[(at + step + sections.length) % sections.length]
    if (next && next.id !== section) onSectionChange(next.id)
  }

  return (
    <ToolFrame
      title={projectName}
      {...(typeLabel ? { titleExtra: <span className="projpage-type" title={`Тип проекта: ${typeLabel}`}>{typeLabel}</span> } : {})}
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
          {sections.map((s) => (
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
export function ProjectsEmptyPage({ invitationCount = 0 }: { invitationCount?: number } = {}): JSX.Element {
  // Если есть приглашение, «создайте первый проект» — неверный следующий шаг:
  // человека уже позвали, ему надо принять, а не заводить своё.
  const invited = invitationCount > 0
  return (
    <ToolFrame title="Проекты" variant="page" testId="projects-empty">
      <div className="proj-page-state">
        <EmptyState
          icon="🗂"
          title={invited ? 'Вас пригласили в проект' : 'Проектов пока нет'}
          description={invited
            ? `Приглашений: ${invitationCount}. Примите их в списке слева — проект появится здесь. Или создайте свой кнопкой «+ Новый проект».`
            : 'Создайте первый в сайдбаре — кнопка «+ Новый проект». Внутри проекта появятся доска, задачи и CI.'}
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
