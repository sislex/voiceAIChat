// Просмотр кадра на любом экране: масштаб, свайп и сочетания панели. Логика
// чистая, потому что одна и та же арифметика решает и как выглядит кнопка
// масштаба, и в какие координаты превратится касание.

import { describe, it, expect } from 'vitest'
import { fitScale, frameWidth, nextFrameZoom, panelShortcut, pinchDistance, touchScrollDelta } from './frameView'

describe('масштаб кадра', () => {
  it('из режима «вписан» увеличение входит в лестницу от текущего фактического масштаба', () => {
    // Панель 640px на вьюпорт 1280 — кадр показан вдвое меньше натурального.
    expect(nextFrameZoom('fit', 'in', fitScale(640, 1280))).toBe(0.75)
    expect(nextFrameZoom('fit', 'out', fitScale(640, 1280))).toBe(0.5)
  })

  it('лестница не выходит за края', () => {
    expect(nextFrameZoom(3, 'in', 1)).toBe(3)
    expect(nextFrameZoom(0.5, 'out', 1)).toBe(0.5)
  })

  it('ширина задаётся числом только при явном масштабе', () => {
    expect(frameWidth('fit', 1280)).toBeNull()
    expect(frameWidth(1, 1280)).toBe(1280)
    expect(frameWidth(0.5, 1281)).toBe(641)
  })

  it('масштаб «вписан» при неизвестной ширине не делит на ноль', () => {
    expect(fitScale(0, 1280)).toBe(1)
    expect(fitScale(640, 0)).toBe(1)
  })
})

describe('жесты по кадру', () => {
  it('палец вверх прокручивает страницу вниз, как в любом мобильном браузере', () => {
    const delta = touchScrollDelta({ clientX: 100, clientY: 300 }, { clientX: 100, clientY: 200 }, { width: 390, height: 844 }, { width: 390, height: 844 })
    expect(delta).toEqual({ deltaX: 0, deltaY: 100 })
  })

  it('дельта пересчитывается в координаты вьюпорта, а не экрана', () => {
    // Кадр 1280px показан на 640px: движение пальца на 50px — это 100px страницы.
    const delta = touchScrollDelta({ clientX: 0, clientY: 150 }, { clientX: 0, clientY: 100 }, { width: 640, height: 400 }, { width: 1280, height: 800 })
    expect(delta.deltaY).toBe(100)
  })

  it('расстояние между пальцами считается по обеим осям', () => {
    expect(pinchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5)
  })
})

describe('сочетания клавиш панели', () => {
  const event = (over: Partial<Parameters<typeof panelShortcut>[0]>) =>
    panelShortcut({ key: 'a', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over })

  it('Alt+стрелки ходят по истории, как в окружающем браузере', () => {
    expect(event({ key: 'ArrowLeft', altKey: true })).toBe('back')
    expect(event({ key: 'ArrowRight', altKey: true })).toBe('forward')
  })

  it('перезагрузка и фокус в адрес работают и с Ctrl, и с Cmd', () => {
    expect(event({ key: 'r', ctrlKey: true })).toBe('reload')
    expect(event({ key: 'R', metaKey: true })).toBe('reload')
    expect(event({ key: 'l', metaKey: true })).toBe('address')
  })

  it('Escape выходит из развёрнутого кадра', () => {
    expect(event({ key: 'Escape' })).toBe('exitFullscreen')
  })

  it('обычные клавиши не перехватываются: они принадлежат странице', () => {
    expect(event({ key: 'r' })).toBeNull()
    expect(event({ key: 'ArrowLeft' })).toBeNull()
    expect(event({ key: 'r', ctrlKey: true, altKey: true })).toBeNull()
  })
})
