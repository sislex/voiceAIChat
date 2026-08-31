// Раскрываемое событие ленты: шеврон, точка состояния, заголовок, время справа.
//
// Классы `.vc-feed-*` появились раньше самого компонента — временная шкала,
// улучшения и merge-шаги повторяли эту разметку руками, и она успела разъехаться
// (у одной ленты шеврон был, у другой нет). Здесь она одна.
//
// `details/summary`, а не своё раскрытие на состоянии: клавиатура, поиск по
// странице и печать работают без нашего участия.

import type { ReactNode } from 'react'
import type { StatusTone } from './StatusPill'

/** Тон точки: у ленты он совпадает с тоном лозенги, поэтому тип общий. */
const DOT_MODIFIER: Record<StatusTone, string> = {
  neutral: 'vc-feed-dot--muted',
  // `accent` пришёл вместе с объединением лозенг: выделение читается так же,
  // как «идёт работа», — точка одна и та же.
  accent: 'vc-feed-dot--progress',
  running: 'vc-feed-dot--progress',
  success: 'vc-feed-dot--success',
  warning: 'vc-feed-dot--progress',
  danger: 'vc-feed-dot--danger'
}

export interface FeedItemProps {
  title: ReactNode
  tone?: StatusTone
  /** Правый край строки: время события, число строк лога, длительность. */
  meta?: ReactNode
  /** Раскрыто сразу — так показывают текущее событие активного рана. */
  defaultOpen?: boolean
  /** Скрывать шеврон у элемента без содержимого. */
  children?: ReactNode
  className?: string
  testId?: string
}

export function FeedItem({ title, tone = 'neutral', meta, defaultOpen = false, children, className, testId }: FeedItemProps): JSX.Element {
  return (
    <details
      className={['vc-feed-item', className].filter(Boolean).join(' ')}
      open={defaultOpen}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <summary>
        <span className="vc-feed-caret" aria-hidden="true" />
        <span className={`vc-feed-dot ${DOT_MODIFIER[tone]}`} aria-hidden="true" />
        <span className="vc-feed-item__title">{title}</span>
        {meta != null && <span className="vc-feed-status">{meta}</span>}
      </summary>
      {children}
    </details>
  )
}

export interface FeedLogProps {
  /** Текст лога как есть: переносы и отступы значимы. */
  children: string
  /** Имя области для скринридера — иначе прокручиваемый блок безымянный. */
  label?: string
  className?: string
  testId?: string
}

/**
 * Лог внутри события ленты. Терминал у нас тёмный в обеих темах — лог читают как
 * лог, а не как страницу, — поэтому подложка здесь не зависит от темы.
 * `tabIndex` обязателен: без него прокручиваемую область не пролистать с
 * клавиатуры.
 */
export function FeedLog({ children, label = 'Лог', className, testId = 'feed-log' }: FeedLogProps): JSX.Element {
  return (
    <pre className={['vc-feed-log', className].filter(Boolean).join(' ')} tabIndex={0} role="group" aria-label={label} data-testid={testId}>
      {children}
    </pre>
  )
}
