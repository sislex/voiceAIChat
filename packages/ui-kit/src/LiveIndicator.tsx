// «Live» у ленты активного рана: точка с ореолом и подпись.
//
// Роль `status` — намеренно: лента дописывается сама, и без объявления
// скринридер не узнаёт, что экран живой. Сама лента живой областью не делается —
// читалка перебивала бы себя на каждой строке лога.

export interface LiveIndicatorProps {
  /** Что именно идёт: «Live», «Ран активен». */
  label?: string
  /** Погашенный вид, когда ран уже кончился, но блок остаётся на месте. */
  active?: boolean
  className?: string
  testId?: string
}

export function LiveIndicator({ label = 'Live', active = true, className, testId = 'live-indicator' }: LiveIndicatorProps): JSX.Element {
  return (
    <span
      className={['vc-live', !active && 'vc-live--idle', className].filter(Boolean).join(' ')}
      role="status"
      data-testid={testId}
    >
      <span className="vc-live__dot" aria-hidden="true" />
      {label}
    </span>
  )
}
