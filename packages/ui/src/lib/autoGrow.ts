import { useCallback, useLayoutEffect, useRef } from 'react'

export interface AutoGrowMetrics {
  /** `scrollHeight` при `height: auto` — контент плюс вертикальные паддинги (box-sizing: border-box). */
  contentHeight: number
  lineHeight: number
  /** Сумма верхнего и нижнего паддинга. */
  paddingY: number
  /** Сумма верхней и нижней границы: при border-box она входит в `height`. */
  borderY: number
  minRows: number
  maxRows: number
}

/**
 * Высота поля, которая растёт вместе с текстом, но не выходит за [minRows, maxRows].
 * Считаем в пикселях, а не по числу `\n`: длинная строка переносится и визуально
 * занимает несколько строк — её тоже нужно показать целиком.
 */
export function autoGrowHeight({
  contentHeight,
  lineHeight,
  paddingY,
  borderY,
  minRows,
  maxRows
}: AutoGrowMetrics): number {
  const min = minRows * lineHeight + paddingY
  const max = maxRows * lineHeight + paddingY
  return Math.min(Math.max(contentHeight, min), max) + borderY
}

/**
 * Строчная высота элемента. У `line-height: normal` вычисленного значения в px нет,
 * поэтому приближаем её через размер шрифта (как в наших стилях — 1.4).
 */
function resolveLineHeight(cs: CSSStyleDeclaration): number {
  const explicit = Number.parseFloat(cs.lineHeight)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  const fontSize = Number.parseFloat(cs.fontSize)
  return Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.4 : 0
}

function sum(...values: string[]): number {
  return values.reduce((acc, v) => {
    const n = Number.parseFloat(v)
    return acc + (Number.isFinite(n) ? n : 0)
  }, 0)
}

function fitToText(el: HTMLTextAreaElement, minRows: number, maxRows: number): void {
  const cs = getComputedStyle(el)
  const lineHeight = resolveLineHeight(cs)
  if (lineHeight === 0) return // стили ещё не применились — оставляем высоту от rows
  // Сброс перед замером: иначе scrollHeight не даст полю уменьшиться.
  el.style.height = 'auto'
  el.style.height = `${autoGrowHeight({
    contentHeight: el.scrollHeight,
    lineHeight,
    paddingY: sum(cs.paddingTop, cs.paddingBottom),
    borderY: sum(cs.borderTopWidth, cs.borderBottomWidth),
    minRows,
    maxRows
  })}px`
}

/**
 * Подгоняет высоту textarea под текст: от `minRows` строк до `maxRows`, дальше — скролл.
 * Возвращает ref-колбэк: высота считается и при каждом изменении `value`, и в момент
 * появления поля в DOM — иначе поле, открытое сразу с готовым текстом (редактирование
 * сообщения), осталось бы высотой в `minRows`.
 */
export function useAutoGrow(
  value: string,
  minRows: number,
  maxRows: number
): (el: HTMLTextAreaElement | null) => void {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  const fit = useCallback(() => {
    if (ref.current) fitToText(ref.current, minRows, maxRows)
  }, [minRows, maxRows])

  useLayoutEffect(fit, [value, fit])

  return useCallback(
    (el: HTMLTextAreaElement | null) => {
      ref.current = el
      if (el) fitToText(el, minRows, maxRows)
    },
    [minRows, maxRows]
  )
}
