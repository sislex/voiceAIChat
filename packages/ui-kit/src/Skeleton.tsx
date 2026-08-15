// Единый скелетон загрузки.
//
// До него каждый экран рисовал ожидание по-своему: `.pb-skeletons` со своим
// градиентом и `@keyframes pb-shine` в AI-помощнике, `.msgloading` с точками в
// чате, «Загрузка доски…» текстом на канбане, а в проводнике и CI-ленте —
// вообще ничего. Теперь форма ожидания одна, анимация на токенах и отключается
// при `prefers-reduced-motion: reduce`.
//
// Главное правило: скелетон повторяет геометрию реального контента (высота
// карточки задачи, строки лога, ряда таблицы) — иначе при подстановке данных
// прыгает вся раскладка. Поэтому у всех вариантов есть `height`/`width`: экран
// задаёт свои размеры, а не подгоняет контент под скелетон.
//
// Когда показывать — правило `lib/loadState.ts`: скелетон только на первой
// загрузке, при повторной данные остаются на месте, а факт обновления
// показывает `RefreshIndicator`.

import type { CSSProperties } from 'react'

/**
 * line — строка текста (нужна `width`), block — прямоугольник заданной высоты
 * (превью, лог), card — карточка с рамкой и строками внутри (задача, беседа),
 * list — `count` одинаковых элементов подряд.
 */
export type SkeletonVariant = 'line' | 'block' | 'card' | 'list'

export interface SkeletonProps {
  variant?: SkeletonVariant
  /** Ширина (число — пиксели). У `line` по умолчанию 100%. */
  width?: number | string
  /** Высота (число — пиксели): та же, что у настоящего элемента. */
  height?: number | string
  /** Сколько элементов у `list`. */
  count?: number
  /** Из чего состоит `list`. */
  item?: Exclude<SkeletonVariant, 'list'>
  /** Сколько строк внутри `card`. */
  lines?: number
  /** Зазор между элементами `list` (число — пиксели). */
  gap?: number | string
  className?: string
  /** Класс элемента списка (сам `className` у `list` достаётся контейнеру). */
  itemClassName?: string
  /** По умолчанию `skeleton` — по нему скелетон находят тесты. */
  testId?: string
}

function size(value: number | string | undefined): string | undefined {
  if (value == null) return undefined
  return typeof value === 'number' ? `${value}px` : value
}

/** Ширины строк внутри карточки: заголовок длиннее, подпись короче. */
const LINE_WIDTHS = ['64%', '92%', '40%']

export function Skeleton({
  variant = 'line',
  width,
  height,
  count = 3,
  item = 'card',
  lines = 3,
  gap,
  className,
  itemClassName,
  testId = 'skeleton'
}: SkeletonProps): JSX.Element {
  const cls = (...parts: Array<string | false | undefined>): string => parts.filter(Boolean).join(' ')

  if (variant === 'list') {
    const style: CSSProperties = {}
    if (gap != null) style.gap = size(gap)
    return (
      <div className={cls('vc-skel-list', className)} style={style} data-testid={`${testId}-list`}>
        {Array.from({ length: Math.max(0, count) }, (_, i) => (
          <Skeleton
            key={i}
            variant={item}
            testId={testId}
            {...(itemClassName != null ? { className: itemClassName } : {})}
            {...(width != null ? { width } : {})}
            {...(height != null ? { height } : {})}
            lines={lines}
          />
        ))}
      </div>
    )
  }

  if (variant === 'card') {
    const style: CSSProperties = {}
    if (height != null) style.height = size(height)
    if (width != null) style.width = size(width)
    return (
      <div className={cls('vc-skel-card', className)} style={style} data-testid={testId} aria-hidden="true">
        {Array.from({ length: Math.max(1, lines) }, (_, i) => (
          <span key={i} className="vc-skel vc-skel--line" style={{ width: LINE_WIDTHS[i % LINE_WIDTHS.length] }} />
        ))}
      </div>
    )
  }

  const style: CSSProperties = {}
  if (width != null) style.width = size(width)
  if (height != null) style.height = size(height)
  return (
    <span
      className={cls('vc-skel', `vc-skel--${variant}`, className)}
      style={style}
      data-testid={testId}
      aria-hidden="true"
    />
  )
}

export interface RefreshIndicatorProps {
  /** Подпись; она же уходит в скринридер. */
  label?: string
  className?: string
  testId?: string
}

/**
 * Неблокирующий индикатор повторной загрузки: данные остаются на экране, а он
 * говорит, что они обновляются. Именно он, а не скелетон, показывается со
 * второго раза — подмена уже показанного списка скелетоном читается как мигание.
 */
export function RefreshIndicator({
  label = 'Обновляем…',
  className,
  testId = 'refreshing'
}: RefreshIndicatorProps): JSX.Element {
  return (
    <span className={['vc-refresh', className].filter(Boolean).join(' ')} role="status" data-testid={testId}>
      <span className="vc-refresh__spinner" aria-hidden="true" />
      {label}
    </span>
  )
}
