// Окружение jsdom вопреки имени файла (без `.dom.`): компоненты здесь не
// рендерятся, но геометрия и pointer-события переноса.
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  DRAG_HOLD_MS,
  autoScroll,
  createDragEngine,
  edgeScrollDelta,
  nearestByCenterY,
  nearestElement,
  pointInRect,
  rectDistance,
  type PointerDragSpec
} from './dnd'

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect

function box(left: number, top: number, width: number, height: number): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => rect(left, top, width, height)
  document.body.appendChild(el)
  return el
}

describe('dnd: геометрия', () => {
  it('pointInRect включает кромки', () => {
    const r = rect(10, 10, 100, 50)
    expect(pointInRect(r, { x: 50, y: 30 })).toBe(true)
    expect(pointInRect(r, { x: 10, y: 60 })).toBe(true)
    expect(pointInRect(r, { x: 9, y: 30 })).toBe(false)
    expect(pointInRect(r, { x: 50, y: 61 })).toBe(false)
  })

  it('rectDistance: 0 внутри, иначе — до ближайшей кромки', () => {
    const r = rect(0, 0, 100, 100)
    expect(rectDistance(r, { x: 50, y: 50 })).toBe(0)
    expect(rectDistance(r, { x: 130, y: 50 })).toBe(30)
    expect(rectDistance(r, { x: 103, y: 104 })).toBeCloseTo(5)
  })

  it('nearestElement выбирает ближайшую цель, даже если указатель вне всех', () => {
    const left = box(0, 0, 100, 100)
    const right = box(400, 0, 100, 100)
    expect(nearestElement([left, right], { x: 480, y: 500 })).toBe(right)
    expect(nearestElement([left, right], { x: -50, y: 20 })).toBe(left)
    expect(nearestElement([], { x: 0, y: 0 })).toBeNull()
  })

  it('nearestByCenterY выбирает зону вставки по центру', () => {
    const top = box(0, 0, 100, 10)
    const bottom = box(0, 200, 100, 10)
    expect(nearestByCenterY([top, bottom], 30)).toBe(top)
    expect(nearestByCenterY([top, bottom], 150)).toBe(bottom)
  })
})

describe('dnd: авто-скролл у краёв', () => {
  it('в середине не скроллит, у кромок — в свою сторону', () => {
    expect(edgeScrollDelta(300, 0, 600)).toBe(0)
    expect(edgeScrollDelta(10, 0, 600)).toBeLessThan(0)
    expect(edgeScrollDelta(595, 0, 600)).toBeGreaterThan(0)
  })

  it('скорость растёт к самой кромке и не превышает speed', () => {
    const near = edgeScrollDelta(50, 0, 600, 56, 18)
    const edge = edgeScrollDelta(0, 0, 600, 56, 18)
    expect(Math.abs(near)).toBeLessThan(Math.abs(edge))
    expect(Math.abs(edge)).toBe(18)
  })

  it('на коротком контейнере зона у края не съедает его целиком', () => {
    // Высота 30px: зона — 10px, поэтому центр (y=15) остаётся нейтральным.
    expect(edgeScrollDelta(15, 0, 30, 56, 18)).toBe(0)
    expect(edgeScrollDelta(2, 0, 30, 56, 18)).toBeLessThan(0)
    expect(edgeScrollDelta(0, 0, 0)).toBe(0)
  })

  it('autoScroll крутит нужную ось и сообщает сдвиг', () => {
    const el = box(0, 0, 600, 400)
    expect(autoScroll(el, { x: 300, y: 200 }, 'y')).toBe(0)
    expect(autoScroll(el, { x: 300, y: 395 }, 'y')).toBeGreaterThan(0)
    expect(autoScroll(el, { x: 2, y: 200 }, 'x')).toBeLessThan(0)
  })
})

describe('dnd: распознавание жеста', () => {
  const calls: string[] = []
  const spec = (over: Partial<PointerDragSpec> = {}): PointerDragSpec => ({
    lift: null,
    onStart: () => calls.push('start'),
    onMove: () => calls.push('move'),
    onDrop: () => calls.push('drop'),
    onCancel: () => calls.push('cancel'),
    ...over
  })

  let detach: (() => void) | null = null
  afterEach(() => {
    detach?.()
    detach = null
    calls.length = 0
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  function start(over: Partial<PointerDragSpec> = {}, init: PointerEventInit = {}) {
    const engine = createDragEngine()
    detach = engine.attach()
    const handle = document.createElement('div')
    document.body.appendChild(handle)
    const s = spec(over)
    const onDown = (e: Event): void => engine.begin(e as PointerEvent, s)
    handle.addEventListener('pointerdown', onDown)
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, pointerId: 1, ...init }))
    handle.removeEventListener('pointerdown', onDown)
    return engine
  }

  const send = (type: string, x: number, y: number, init: PointerEventInit = {}): void => {
    window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, ...init }))
  }

  it('мышь: смещение меньше порога — это клик, а не перенос', () => {
    start()
    send('pointermove', 103, 102)
    expect(calls).toEqual([])
    send('pointerup', 103, 102)
    expect(calls).toEqual([])
  })

  it('мышь: после порога идут start/move, отпускание даёт drop', () => {
    start()
    send('pointermove', 120, 100)
    expect(calls).toEqual(['start', 'move'])
    send('pointermove', 140, 100)
    send('pointerup', 140, 100)
    expect(calls).toEqual(['start', 'move', 'move', 'drop'])
  })

  it('палец: перенос начинается по удержанию', () => {
    vi.useFakeTimers()
    start({}, { pointerType: 'touch' })
    expect(calls).toEqual([])
    vi.advanceTimersByTime(DRAG_HOLD_MS)
    expect(calls).toEqual(['start'])
    send('pointerup', 100, 100, { pointerType: 'touch' })
    expect(calls).toEqual(['start', 'drop'])
  })

  it('палец: уехал до конца удержания — это скролл, жест отдаём браузеру', () => {
    vi.useFakeTimers()
    start({}, { pointerType: 'touch' })
    send('pointermove', 100, 140, { pointerType: 'touch' })
    vi.advanceTimersByTime(DRAG_HOLD_MS * 3)
    send('pointerup', 100, 140, { pointerType: 'touch' })
    expect(calls).toEqual([])
  })

  it('ручка захвата: палец начинает перенос сразу, без удержания', () => {
    vi.useFakeTimers()
    start({ immediate: true }, { pointerType: 'touch' })
    expect(calls).toEqual(['start'])
  })

  it('pointercancel и Esc отменяют перенос, drop не приходит', () => {
    start()
    send('pointermove', 120, 100)
    send('pointercancel', 120, 100)
    expect(calls).toEqual(['start', 'move', 'cancel'])

    calls.length = 0
    detach?.()
    start()
    send('pointermove', 120, 100)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(calls).toEqual(['start', 'move', 'cancel'])
  })

  it('приподнятая копия живёт только во время переноса и не двоит testid', () => {
    const source = document.createElement('div')
    source.dataset.testid = 'task-card'
    source.id = 'card-1'
    source.textContent = 'Задача'
    document.body.appendChild(source)

    start({ lift: source })
    send('pointermove', 120, 100)
    const ghost = document.querySelector('.vc-drag-ghost')
    expect(ghost).not.toBeNull()
    expect(ghost?.getAttribute('data-testid')).toBeNull()
    expect(ghost?.id).toBe('')
    expect(document.body.classList.contains('vc-dragging')).toBe(true)

    send('pointerup', 120, 100)
    expect(document.querySelector('.vc-draglayer')).toBeNull()
    expect(document.body.classList.contains('vc-dragging')).toBe(false)
  })
})
