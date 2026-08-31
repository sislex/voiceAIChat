// Вкладки с полноценной клавиатурой.
//
// Раньше каждая страница собирала свой ряд кнопок с `role="tab"`, но без
// `tabpanel`, без roving tabindex и без стрелок: скринридер объявлял вкладки,
// а перейти между ними с клавиатуры было нельзя. Правило одно на всех — здесь.

import { useRef, type ReactNode } from 'react'

export interface TabItem {
  id: string
  label: ReactNode
  /** Счётчик рядом с подписью (машины, события). Ноль тоже показываем: «0» — факт. */
  count?: number
  /** Скрытая вкладка остаётся в модели, но не рисуется: права, а не удаление. */
  hidden?: boolean
}

export interface TabsProps {
  items: readonly TabItem[]
  activeId: string
  onChange: (id: string) => void
  /** Название группы для скринридера: «Разделы пользователя». */
  label: string
  /** id панели, которой управляют вкладки, — связь tab ↔ tabpanel. */
  panelId?: string
  className?: string
  testId?: string
}

export function Tabs({ items, activeId, onChange, label, panelId, className, testId = 'tabs' }: TabsProps): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const visible = items.filter((item) => !item.hidden)

  // Стрелки ходят по вкладкам, Home/End прыгают к краям — так вкладки ведут себя
  // во всех нативных реализациях, и человек не обязан угадывать нашу.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const index = visible.findIndex((item) => item.id === activeId)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? visible.length - 1
      : event.key === 'ArrowLeft' ? (index - 1 + visible.length) % visible.length
      : (index + 1) % visible.length
    const target = visible[next]
    if (!target) return
    onChange(target.id)
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${CSS.escape(target.id)}"]`)?.focus()
  }

  return (
    <div
      ref={listRef}
      className={['vc-tabs', className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      data-testid={testId}
    >
      {visible.map((item) => {
        const active = item.id === activeId
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${testId}-${item.id}`}
            data-tab-id={item.id}
            aria-selected={active}
            {...(panelId ? { 'aria-controls': panelId } : {})}
            tabIndex={active ? 0 : -1}
            className={active ? 'vc-tab vc-tab--on' : 'vc-tab'}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {item.count !== undefined && <span className="vc-tab__count">{item.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
