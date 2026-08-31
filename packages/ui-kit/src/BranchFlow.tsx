// «Ветка задачи → целевая ветка» с подписью об изменениях.
//
// В merge-панели это была строка текста вида «CHAT-326 → main», из которой не
// читалось, что откуда и куда: обе ветки выглядели одинаково, а стрелка
// произносилась читалкой как «больше».

import type { ReactNode } from 'react'

export interface BranchFlowProps {
  from: string
  /** Куда сливаем; по умолчанию `main`. */
  to?: string
  /** Что везём: «6 файлов изменено · +284 −31». */
  note?: ReactNode
  className?: string
  testId?: string
}

export function BranchFlow({ from, to = 'main', note, className, testId = 'branch-flow' }: BranchFlowProps): JSX.Element {
  return (
    <div className={['vc-branch-flow', className].filter(Boolean).join(' ')} data-testid={testId}>
      <p className="vc-branch-flow__row">
        <code className="vc-branch-flow__branch">{from}</code>
        {/* Стрелка декоративна: направление проговорено словом рядом. */}
        <span className="vc-branch-flow__arrow" aria-hidden="true">→</span>
        <span className="vc-sr-only">сливается в</span>
        <code className="vc-branch-flow__branch">{to}</code>
      </p>
      {note != null && <p className="vc-branch-flow__note">{note}</p>}
    </div>
  )
}
