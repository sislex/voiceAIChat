// Переключатель разделов внутри панели вкладки («Обзор · Работа модели · Проверки»).
//
// Намеренно **не** `role="tablist"`: полоса вкладок карточки уже tablist, а
// вложенный требует своих `tabpanel` с `aria-controls` — панелей у него нет, и
// axe справедливо ругался. Здесь это группа кнопок-переключателей, состояние
// которых объявляется через `aria-pressed`.

import type { ReactNode } from 'react'

export interface SubTabItem<T extends string = string> {
  id: T
  label: ReactNode
  /** Счётчик в пилюле справа от подписи; ноль не рисуется. */
  count?: number
}

export interface SubTabsProps<T extends string = string> {
  items: readonly SubTabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Имя группы для скринридера: «Разделы хода выполнения». */
  ariaLabel: string
  className?: string
  testId?: string
}

export function SubTabs<T extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
  testId = 'subtabs'
}: SubTabsProps<T>): JSX.Element {
  return (
    <div className={['vc-subtabs', className].filter(Boolean).join(' ')} role="group" aria-label={ariaLabel} data-testid={testId}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === value ? 'vc-subtab vc-subtab--active' : 'vc-subtab'}
          aria-pressed={item.id === value}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count ? <span className="vc-subtab__count">{item.count}</span> : null}
        </button>
      ))}
    </div>
  )
}
