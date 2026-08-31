// Шаги этапа: «Репозиторий синхронизирован», «Создание merge commit», «Push».
//
// Порядок здесь — часть смысла (шаг 3 идёт после шага 2), поэтому это `ol`, а не
// набор строк. Состояние показывается значком, но значок скрыт от скринридера:
// «✓» он прочитает как «галочка», а нужно «выполнено» — поэтому рядом стоит
// невидимая подпись состояния.

import type { ReactNode } from 'react'

export type StepState = 'pending' | 'running' | 'done' | 'failed'

/** Подпись состояния для скринридера: значок сам по себе ничего не сообщает. */
const STATE_LABEL: Record<StepState, string> = {
  pending: 'Ожидает',
  running: 'Выполняется',
  done: 'Выполнено',
  failed: 'Не выполнено'
}

const STATE_MARK: Record<StepState, string> = { pending: '', running: '↗', done: '✓', failed: '!' }

export interface StepItem {
  /** Ключ списка; без него берётся порядковый номер. */
  id?: string
  title: ReactNode
  /** Подробность шага: длительность, счётчик файлов, причина падения. */
  detail?: ReactNode
  state?: StepState
}

export interface StepListProps {
  steps: readonly StepItem[]
  className?: string
  testId?: string
}

export function StepList({ steps, className, testId = 'step-list' }: StepListProps): JSX.Element {
  return (
    <ol className={['vc-steps', className].filter(Boolean).join(' ')} data-testid={testId}>
      {steps.map((step, index) => {
        const state = step.state ?? 'pending'
        return (
          <li className={`vc-step vc-step--${state}`} key={step.id ?? index} data-state={state}>
            {/* У ожидающего шага в кружке стоит его номер — так видно, сколько ещё впереди. */}
            <span className="vc-step__mark" aria-hidden="true">{STATE_MARK[state] || String(index + 1)}</span>
            <span className="vc-step__body">
              <span className="vc-step__title">{step.title}</span>
              {step.detail != null && <span className="vc-step__detail">{step.detail}</span>}
            </span>
            <span className="vc-sr-only">{STATE_LABEL[state]}</span>
          </li>
        )
      })}
    </ol>
  )
}
