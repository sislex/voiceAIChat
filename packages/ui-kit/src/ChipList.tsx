// Список чипов с удалением и полем добавления: метки и навыки задачи.
//
// Раньше эти два списка были скопированы друг у друга слово в слово, вместе с
// обработчиком Enter и «сохранить по blur». Правка одного не доезжала до
// второго — так у навыков однажды перестала работать отправка по Enter.
//
// Значение хранит вызывающая сторона: компонент презентационный, черновик поля
// ввода — его единственное собственное состояние.

import { useState } from 'react'

export interface ChipListProps {
  items: readonly string[]
  /** Что это за список — уходит в подписи кнопок удаления и поля ввода. */
  itemLabel: string
  /** Плейсхолдер поля добавления: «+ метка». */
  placeholder: string
  /** Добавить значение. Дубликаты и пустые строки компонент отсекает сам. */
  onAdd: (value: string) => void
  onRemove: (value: string) => void
  /** Класс чипа — у меток и навыков разный цвет. */
  chipClassName?: string
  className?: string
  testId?: string
}

export function ChipList({
  items,
  itemLabel,
  placeholder,
  onAdd,
  onRemove,
  chipClassName = 'vc-chip',
  className,
  testId
}: ChipListProps): JSX.Element {
  const [draft, setDraft] = useState('')
  // Пустое и повторное значение до вызывающей стороны не доходят: иначе каждый
  // список повторял бы эту проверку у себя (и один из двух её терял).
  const commit = (): void => {
    const value = draft.trim()
    setDraft('')
    if (value && !items.includes(value)) onAdd(value)
  }
  return (
    <span className={['vc-chips', className].filter(Boolean).join(' ')} {...(testId ? { 'data-testid': testId } : {})}>
      {items.map((item) => (
        <span key={item} className={chipClassName}>
          {item}
          <button
            type="button"
            className="vc-chip__remove"
            aria-label={`Убрать ${itemLabel} ${item}`}
            title={`Убрать ${itemLabel}`}
            onClick={() => onRemove(item)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="vc-chips__input"
        aria-label={`Новый ${itemLabel}`}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          commit()
        }}
        onBlur={commit}
      />
    </span>
  )
}
