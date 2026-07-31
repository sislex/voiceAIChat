// Перетаскивание на pointer-событиях — один механизм для карточек и колонок канбана.
//
// Почему не HTML5 Drag & Drop, с которого доска начиналась: мобильные браузеры не
// генерируют dragstart/drop вовсе, поэтому на телефоне и планшете задачу нельзя
// было передвинуть в принципе. Pointer-события одинаковы для мыши, пальца и
// стилуса — механизм на все виды ввода получается один.
//
// Жест распознаётся по-разному, и это здесь главное: мышь — смещение на
// DRAG_THRESHOLD_PX (иначе обычный клик по карточке превращался бы в перенос),
// палец — удержание DRAG_HOLD_MS почти без движения (иначе перенос отнял бы у
// пользователя привычный скролл колонки и доски). Уехал палец раньше — жест
// отдаём браузеру, это скролл. Явная «ручка» захвата (единственное место с
// touch-action: none) начинает перенос сразу.
//
// Геометрию модуль не знает: он ведёт приподнятую копию под пальцем и сообщает
// точки, а цель по точке считает сам экран — для этого здесь есть pointInRect /
// nearestElement / nearestByCenterY и авто-скролл у краёв (autoScroll).

import { useCallback, useLayoutEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export interface DragPoint {
  x: number
  y: number
}

/** Порог для мыши: меньше — это клик, а не перенос. */
export const DRAG_THRESHOLD_PX = 6
/** Удержание для пальца: меньше — жест не отличить от скролла. */
export const DRAG_HOLD_MS = 200

export interface PointerDragSpec {
  /** Элемент, приподнятую копию которого ведём под указателем. */
  lift: HTMLElement | null
  /** Захват начат с «ручки» (touch-action: none) — удержание пальца не нужно. */
  immediate?: boolean
  onStart: (point: DragPoint) => void
  onMove: (point: DragPoint) => void
  onDrop: (point: DragPoint) => void
  onCancel: () => void
  /** Кадр анимации активного переноса — сюда экран вешает авто-скролл. */
  tick?: (point: DragPoint) => void
}

export interface DragRect {
  left: number
  top: number
  right: number
  bottom: number
}

export function pointInRect(rect: DragRect, p: DragPoint): boolean {
  return p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom
}

/** Расстояние от точки до прямоугольника (0 внутри) — им выбираем ближайшую цель. */
export function rectDistance(rect: DragRect, p: DragPoint): number {
  const dx = Math.max(rect.left - p.x, 0, p.x - rect.right)
  const dy = Math.max(rect.top - p.y, 0, p.y - rect.bottom)
  return Math.hypot(dx, dy)
}

/** Ближайший к точке элемент: указатель может уйти за пределы всех колонок. */
export function nearestElement<T extends Element>(els: readonly T[], p: DragPoint): T | null {
  let best: T | null = null
  let bestDist = Infinity
  for (const el of els) {
    const d = rectDistance(el.getBoundingClientRect(), p)
    if (d < bestDist) {
      bestDist = d
      best = el
    }
  }
  return best
}

/** Ближайшая по вертикали цель внутри колонки — так выбирается зона вставки. */
export function nearestByCenterY<T extends Element>(els: readonly T[], y: number): T | null {
  let best: T | null = null
  let bestDist = Infinity
  for (const el of els) {
    const r = el.getBoundingClientRect()
    const d = Math.abs((r.top + r.bottom) / 2 - y)
    if (d < bestDist) {
      bestDist = d
      best = el
    }
  }
  return best
}

/**
 * Скорость авто-скролла у края: 0 в середине, ±speed у самой кромки.
 * `near`/`far` — кромки оси (top/bottom либо left/right).
 */
export function edgeScrollDelta(position: number, near: number, far: number, edge = 56, speed = 18): number {
  const size = far - near
  if (size <= 0) return 0
  // На коротком контейнере зона у края не должна съесть его целиком.
  const zone = Math.min(edge, size / 3)
  if (zone <= 0) return 0
  if (position < near + zone) return -Math.round(speed * Math.min(1, (near + zone - position) / zone))
  if (position > far - zone) return Math.round(speed * Math.min(1, (position - (far - zone)) / zone))
  return 0
}

/** Подкрутить контейнер, если указатель у его края. Возвращает фактический сдвиг. */
export function autoScroll(el: HTMLElement, p: DragPoint, axis: 'x' | 'y', edge = 56, speed = 18): number {
  const r = el.getBoundingClientRect()
  const delta = axis === 'y' ? edgeScrollDelta(p.y, r.top, r.bottom, edge, speed) : edgeScrollDelta(p.x, r.left, r.right, edge, speed)
  if (delta === 0) return 0
  if (axis === 'y') el.scrollTop += delta
  else el.scrollLeft += delta
  return delta
}

/**
 * Погасить click, который браузер пришлёт после отпускания указателя: иначе
 * каждый перенос карточки заканчивался бы открытием её модалки.
 */
export function suppressNextClick(): void {
  if (typeof window === 'undefined') return
  const stop = (e: Event): void => {
    e.stopPropagation()
    e.preventDefault()
  }
  window.addEventListener('click', stop, { capture: true, once: true })
  // Клика может и не быть (тач-отмена, Esc) — тогда снимаем слушатель сами,
  // чтобы не съесть чужой клик через минуту.
  window.setTimeout(() => window.removeEventListener('click', stop, true), 400)
}

interface Ghost {
  layer: HTMLElement
  clone: HTMLElement
  dx: number
  dy: number
}

function createGhost(source: HTMLElement, point: DragPoint): Ghost {
  const rect = source.getBoundingClientRect()
  const layer = document.createElement('div')
  layer.className = 'vc-draglayer'
  const clone = source.cloneNode(true) as HTMLElement
  clone.classList.add('vc-drag-ghost')
  clone.setAttribute('aria-hidden', 'true')
  // Копия не должна быть найдена ни тестами, ни хит-тестом, ни табуляцией:
  // это картинка под пальцем, а не второй экземпляр карточки.
  for (const el of [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))]) {
    el.removeAttribute('data-testid')
    el.removeAttribute('data-dropzone')
    el.removeAttribute('data-drop-body')
    el.removeAttribute('data-column-id')
    el.removeAttribute('id')
    if (el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
  }
  clone.style.width = `${rect.width || source.offsetWidth}px`
  layer.appendChild(clone)
  document.body.appendChild(layer)
  const ghost: Ghost = { layer, clone, dx: point.x - rect.left, dy: point.y - rect.top }
  moveGhost(ghost, point)
  return ghost
}

function moveGhost(g: Ghost, p: DragPoint): void {
  g.clone.style.transform = `translate3d(${Math.round(p.x - g.dx)}px, ${Math.round(p.y - g.dy)}px, 0) scale(1.02)`
}

interface Gesture {
  pointerId: number
  touch: boolean
  spec: PointerDragSpec
  origin: DragPoint
  point: DragPoint
  started: boolean
  hold: number | null
  capture: HTMLElement | null
  ghost: Ghost | null
  raf: number | null
}

export interface DragEngine {
  begin: (e: ReactPointerEvent<HTMLElement> | PointerEvent, spec: PointerDragSpec) => void
  /** Подписать движок на события окна; вернёт отписку (она же отменяет перенос). */
  attach: () => () => void
}

/**
 * Движок жеста, без React: одно перетаскивание за раз, слушатели на window
 * (после setPointerCapture события всё равно приходят на окно, а капчур есть не
 * во всех движках и его нет в jsdom).
 */
export function createDragEngine(): DragEngine {
  let g: Gesture | null = null

  const clear = (gesture: Gesture): void => {
    if (gesture.hold != null) window.clearTimeout(gesture.hold)
    if (gesture.raf != null) cancelAnimationFrame(gesture.raf)
    if (gesture.capture && typeof gesture.capture.releasePointerCapture === 'function') {
      try {
        gesture.capture.releasePointerCapture(gesture.pointerId)
      } catch {
        // указатель уже отпущен браузером — освобождать нечего
      }
    }
    gesture.ghost?.layer.remove()
    document.body.classList.remove('vc-dragging')
  }

  const loop = (): void => {
    if (!g || !g.started) return
    g.spec.tick?.(g.point)
    g.raf = requestAnimationFrame(loop)
  }

  const start = (point: DragPoint): void => {
    if (!g || g.started) return
    g.started = true
    if (g.hold != null) {
      window.clearTimeout(g.hold)
      g.hold = null
    }
    // Выделение текста, начатое мышью до порога, осталось бы висеть на карточке.
    try {
      document.getSelection()?.removeAllRanges()
    } catch {
      // окружение без Selection API
    }
    g.ghost = g.spec.lift ? createGhost(g.spec.lift, point) : null
    document.body.classList.add('vc-dragging')
    g.spec.onStart(point)
    if (g.spec.tick) g.raf = requestAnimationFrame(loop)
  }

  const finish = (mode: 'drop' | 'cancel', point: DragPoint): void => {
    const gesture = g
    if (!gesture) return
    g = null
    const started = gesture.started
    clear(gesture)
    if (!started) return
    suppressNextClick()
    if (mode === 'drop') gesture.spec.onDrop(point)
    else gesture.spec.onCancel()
  }

  const begin = (e: ReactPointerEvent<HTMLElement> | PointerEvent, spec: PointerDragSpec): void => {
    if (g) return
    const native = ('nativeEvent' in e ? e.nativeEvent : e) as PointerEvent
    // Только основная кнопка: правая открывает контекстное меню, средняя скроллит.
    if (typeof native.button === 'number' && native.button > 0) return
    const touch = (native.pointerType || 'mouse') !== 'mouse'
    const point = { x: native.clientX ?? 0, y: native.clientY ?? 0 }
    const gesture: Gesture = {
      pointerId: native.pointerId ?? 1,
      touch,
      spec,
      origin: point,
      point,
      started: false,
      hold: null,
      capture: null,
      ghost: null,
      raf: null
    }
    g = gesture
    const target = (e.currentTarget ?? null) as HTMLElement | null
    if (target && typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(gesture.pointerId)
        gesture.capture = target
      } catch {
        // капчур недоступен — обойдёмся слушателями на window
      }
    }
    if (touch) {
      if (spec.immediate) start(point)
      else gesture.hold = window.setTimeout(() => start(gesture.point), DRAG_HOLD_MS)
    }
  }

  const onMove = (ev: PointerEvent): void => {
    const gesture = g
    if (!gesture) return
    if (ev.pointerId != null && gesture.pointerId != null && ev.pointerId !== gesture.pointerId) return
    const point = { x: ev.clientX ?? gesture.point.x, y: ev.clientY ?? gesture.point.y }
    gesture.point = point
    if (!gesture.started) {
      const moved = Math.hypot(point.x - gesture.origin.x, point.y - gesture.origin.y)
      if (gesture.touch) {
        // Палец поехал до конца удержания — это скролл: жест отдаём браузеру.
        if (moved > DRAG_THRESHOLD_PX) {
          clear(gesture)
          g = null
        }
        return
      }
      if (moved < DRAG_THRESHOLD_PX) return
      start(point)
    }
    // Пока перенос идёт, браузер не должен ни скроллить, ни выделять.
    if (ev.cancelable) ev.preventDefault()
    if (gesture.ghost) moveGhost(gesture.ghost, point)
    gesture.spec.onMove(point)
  }

  const onUp = (ev: PointerEvent): void => {
    if (!g) return
    finish('drop', { x: ev.clientX ?? g.point.x, y: ev.clientY ?? g.point.y })
  }

  // Пока карточку несут пальцем, страница скроллиться не должна. pointermove для
  // тача приходит не-cancelable, поэтому гасить надо именно touchmove: иначе
  // браузер уводит жест в скролл и вместо переноса присылает pointercancel
  // (проверено в Chrome: без этого тач-перенос заканчивался отменой).
  const onTouchMove = (ev: TouchEvent): void => {
    if (g?.started && g.touch && ev.cancelable) ev.preventDefault()
  }

  const onPointerCancel = (): void => {
    // Входящий звонок, системный жест, потеря капчура — карточка возвращается.
    if (g) finish('cancel', g.point)
  }

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (g && ev.key === 'Escape') {
      ev.preventDefault()
      // Именно stopImmediatePropagation: Esc страницы-обёртки (useDialogStack)
      // висит на том же window в той же фазе, и обычный stopPropagation его не
      // гасит — доска закрывалась бы вместе с отменой переноса.
      ev.stopImmediatePropagation()
      finish('cancel', g.point)
    }
  }

  const attach = (): (() => void) => {
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onPointerCancel)
      if (g) {
        const gesture = g
        g = null
        clear(gesture)
      }
    }
  }

  return { begin, attach }
}

export interface PointerDragApi {
  /** Начать распознавание жеста — вызывается из onPointerDown. */
  begin: (e: ReactPointerEvent<HTMLElement>, spec: PointerDragSpec) => void
}

/**
 * Один движок на экран: перетаскиваний одновременно всё равно не больше одного.
 * Своего состояния хук не держит — что именно несут и куда, знает экран
 * (у канбана это dragTask/dragColumn/dropAt), а «несём вообще» видно по классу
 * `vc-dragging` на body.
 */
export function usePointerDrag(): PointerDragApi {
  const engineRef = useRef<DragEngine | null>(null)
  if (!engineRef.current) engineRef.current = createDragEngine()

  // useLayoutEffect, а не useEffect: Esc отмены переноса должен достаться нам
  // раньше Esc обёртки-страницы (useDialogStack подписывается на тот же window в
  // фазе перехвата из useLayoutEffect, а layout-эффекты детей идут раньше
  // родительских — с обычным useEffect страница закрывалась бы вместе с отменой).
  useLayoutEffect(() => engineRef.current!.attach(), [])

  const begin = useCallback((e: ReactPointerEvent<HTMLElement>, spec: PointerDragSpec) => {
    engineRef.current!.begin(e, spec)
  }, [])

  return { begin }
}
