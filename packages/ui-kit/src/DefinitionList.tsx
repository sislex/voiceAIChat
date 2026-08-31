// Пары «подпись → значение»: свойства машины, детали события, поля профиля.
//
// Обычно такое верстают строкой «Подпись: значение» внутри <p>, и скринридер
// читает это сплошным текстом. Настоящий <dl> даёт связь между подписью и
// значением, а на узком экране пары раскладываются в столбец без правок разметки.

import type { ReactNode } from 'react'

export interface DefinitionItem {
  label: string
  value: ReactNode
  /** Пустое значение можно скрыть целиком: «нет данных» лучше не показывать вовсе. */
  hideWhenEmpty?: boolean
}

export interface DefinitionListProps {
  items: readonly DefinitionItem[]
  /** Горизонтальная раскладка: пары в строку, как строка свойств под заголовком. */
  inline?: boolean
  className?: string
  testId?: string
}

export function DefinitionList({ items, inline = false, className, testId }: DefinitionListProps): JSX.Element {
  const visible = items.filter((item) => !(item.hideWhenEmpty && (item.value === null || item.value === undefined || item.value === '')))
  return (
    <dl className={['vc-deflist', inline && 'vc-deflist--inline', className].filter(Boolean).join(' ')} {...(testId ? { 'data-testid': testId } : {})}>
      {visible.map((item) => (
        <div key={item.label} className="vc-deflist__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
