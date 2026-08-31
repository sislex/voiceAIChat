// Строка свойства «подпись | значение».
//
// В правой колонке карточки задачи таких строк девять, и до вынесения каждая
// собиралась руками: где-то `label` с текстовым узлом, где-то `div` со `span` —
// сетка держалась на том, что подпись случайно оказывалась первым ребёнком.
//
// Подпись — часть `label`, когда значение редактируется: `dt`/`dd` списка
// определений формой управления не считаются, и скринридер не связал бы их с
// селектом. Поэтому у компонента два режима, и выбирает их `as`.

import type { ReactNode } from 'react'

export interface PropertyRowProps {
  label: ReactNode
  /**
   * `label` — значение редактируется вложенным контролом (подпись связана с
   * ним), `div` — значение только для чтения.
   */
  as?: 'label' | 'div'
  /** Значение занимает всю ширину строки: чипы, длинный список. */
  wide?: boolean
  children: ReactNode
  className?: string
  testId?: string
}

export function PropertyRow({ label, as = 'div', wide = false, children, className, testId }: PropertyRowProps): JSX.Element {
  const Tag = as
  return (
    <Tag
      className={['vc-prop', wide && 'vc-prop--wide', className].filter(Boolean).join(' ')}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <span className="vc-prop__label">{label}</span>
      {children}
    </Tag>
  )
}
