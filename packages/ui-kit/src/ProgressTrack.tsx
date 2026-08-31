// Прогресс: полоса и кольцо.
//
// Полос в карточке было три штуки разной высоты (подзадачи, QA-счёт, шаг
// интеграционных тестов), и ни одна не объявляла себя скринридеру — «68%» знал
// только зрячий. Здесь `role="progressbar"` обязателен: `label` — единственное
// обязательное поле, потому что безымянный прогрессбар для читалки бесполезен.
//
// Ширина и заполнение передаются CSS-переменной, а не классом: значение
// непрерывное, класса под каждый процент не напасёшься.

import type { CSSProperties } from 'react'
import type { StatusTone } from './StatusPill'

export interface ProgressTrackProps {
  /** Сделано. Больше `max` не бывает — значение подрезается. */
  value: number
  max?: number
  /** Имя прогресса для скринридера: «Подзадачи», «Сценарии QA». */
  label: string
  tone?: StatusTone
  /** Тонкая полоса для плотных мест (строка подзадач). */
  compact?: boolean
  className?: string
  testId?: string
}

/** Доля 0…1: защита от нуля в знаменателе и от значений вне диапазона. */
function ratio(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value / max))
}

export function ProgressTrack({
  value,
  max = 100,
  label,
  tone = 'running',
  compact = false,
  className,
  testId = 'progress-track'
}: ProgressTrackProps): JSX.Element {
  const filled = ratio(value, max)
  return (
    <div
      className={['vc-track', compact && 'vc-track--compact', `vc-track--${tone}`, className].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(max, Math.max(0, value))}
      data-testid={testId}
    >
      <span className="vc-track__fill" style={{ '--vc-progress': `${(filled * 100).toFixed(1)}%` } as CSSProperties} />
    </div>
  )
}

export interface ProgressRingProps {
  value: number
  max?: number
  label: string
  tone?: StatusTone
  /** Что написано в центре; по умолчанию — проценты. */
  caption?: string
  className?: string
  testId?: string
}

/**
 * Кольцо прогресса рядом с заголовком активного рана. Отдельный компонент, а не
 * вариант полосы: у него своя геометрия и своё место — заголовочный блок, где
 * полоса во всю ширину читалась бы как прогресс всей вкладки.
 */
export function ProgressRing({
  value,
  max = 100,
  label,
  tone = 'running',
  caption,
  className,
  testId = 'progress-ring'
}: ProgressRingProps): JSX.Element {
  const filled = ratio(value, max)
  return (
    <div
      className={['vc-ring', `vc-ring--${tone}`, className].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(max, Math.max(0, value))}
      style={{ '--vc-progress': `${(filled * 100).toFixed(1)}%` } as CSSProperties}
      data-testid={testId}
    >
      <span className="vc-ring__caption">{caption ?? `${Math.round(filled * 100)}%`}</span>
    </div>
  )
}
