// Полоса доли: расход по модели, заполненность лимита, доля парка машин.
//
// Три места рисовали её вручную, и каждое по-своему обходилось с нулём и с
// перебором: где-то полоса исчезала, где-то вылезала за дорожку. Плюс полоса
// без текстового значения ничего не сообщает скринридеру.

export interface ProgressBarProps {
  /** Доля 0..1; больше единицы — перебор, он показывается отдельным тоном. */
  value: number
  /** Что именно показано: «Доля расхода Claude Opus». */
  label: string
  /** Готовая подпись значения для скринридера: «$96.40 из $184.20». */
  valueText?: string
  tone?: 'accent' | 'warning' | 'danger'
  className?: string
  testId?: string
}

export function ProgressBar({ value, label, valueText, tone = 'accent', className, testId }: ProgressBarProps): JSX.Element {
  const share = Number.isFinite(value) ? Math.max(0, value) : 0
  const over = share > 1
  return (
    <span
      className={['vc-progress', `vc-progress--${over ? 'danger' : tone}`, className].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(share, 1) * 100)}
      {...(valueText ? { 'aria-valuetext': valueText } : {})}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <i style={{ width: `${Math.round(Math.min(share, 1) * 100)}%` }} />
    </span>
  )
}
