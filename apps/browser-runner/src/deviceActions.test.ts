// Круг 9: настоящий мобильный веб. «Телефон» одной шириной означал, что страница
// верстается как мобильная, но maxTouchPoints остаётся нулём, pointer: coarse не
// срабатывает, а devicePixelRatio равен единице.

import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright'
import { applyDevice, DEVICE_PRESETS, runTouchAction } from './deviceActions'

function fakePage(box: { x: number; y: number; width: number; height: number } | null = { x: 10, y: 20, width: 100, height: 40 }) {
  // Типизируем аргументы мока явно: без этого TypeScript считает список вызовов
  // пустым кортежем и не даёт прочитать полезную нагрузку CDP.
  const send = vi.fn(async (_method: string, _payload?: unknown) => ({}))
  const setViewportSize = vi.fn(async () => {})
  const page = {
    context: () => ({ newCDPSession: async () => ({ send, detach: async () => {} }) }),
    locator: () => ({ first: () => ({ boundingBox: async () => box }) }),
    once: () => {},
    setViewportSize
  } as unknown as Page
  return { page, send, setViewportSize }
}

describe('эмуляция устройства', () => {
  it('пресет телефона включает тач и плотность пикселей, а не только ширину', async () => {
    const { page, send } = fakePage()
    const state = await applyDevice(page, { preset: 'phone' })
    expect(state).toMatchObject({ width: 390, height: 844, deviceScaleFactor: 3, touch: true, orientation: 'portrait' })
    expect(send).toHaveBeenCalledWith('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    expect(send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', expect.objectContaining({ mobile: true, deviceScaleFactor: 3 }))
  })

  it('ландшафт меняет стороны местами и угол экрана', async () => {
    const { page, send } = fakePage()
    const state = await applyDevice(page, { preset: 'phone', orientation: 'landscape' })
    expect(state).toMatchObject({ width: 844, height: 390, orientation: 'landscape' })
    expect(send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', expect.objectContaining({
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    }))
  })

  it('desktop снимает тач: иначе страница считает мышь пальцем', async () => {
    const { page, send } = fakePage()
    const state = await applyDevice(page, { preset: 'desktop' })
    expect(state.touch).toBe(false)
    // maxTouchPoints не передаётся вовсе: Chromium требует 1…16 и отвергает ноль.
    expect(send).toHaveBeenCalledWith('Emulation.setTouchEmulationEnabled', { enabled: false })
  })

  it('неизвестное устройство называет доступные, а не молча берёт десктоп', async () => {
    const { page } = fakePage()
    await expect(applyDevice(page, { preset: 'watch' })).rejects.toThrow(/phone/)
  })

  it('размер уходит и самой странице: иначе перезапуск сессии вернёт десктоп', async () => {
    const { page, setViewportSize } = fakePage()
    await applyDevice(page, { preset: 'phone' })
    expect(setViewportSize).toHaveBeenCalledWith({ width: 390, height: 844 })
  })

  it('свои размеры перекрывают пресет', async () => {
    const { page } = fakePage()
    const state = await applyDevice(page, { preset: 'phone', width: 360, deviceScaleFactor: 2 })
    expect(state).toMatchObject({ width: 360, deviceScaleFactor: 2 })
  })

  it('в наборе есть телефон, андроид, планшет и десктоп', () => {
    expect(Object.keys(DEVICE_PRESETS).sort()).toEqual(['desktop', 'phone', 'phone-android', 'tablet'])
  })
})

describe('жесты пальцем', () => {
  it('тап — это касание и отпускание в центре элемента', async () => {
    const { page, send } = fakePage()
    const result = await runTouchAction(page, { gesture: 'tap', selector: '#save' })
    expect(result.point).toEqual({ x: 60, y: 40 })
    expect(send).toHaveBeenCalledWith('Input.dispatchTouchEvent', expect.objectContaining({ type: 'touchStart' }))
    expect(send).toHaveBeenCalledWith('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  })

  it('свайп идёт шагами: мгновенный перенос пальца страница не засчитывает', async () => {
    const { page, send } = fakePage()
    await runTouchAction(page, { gesture: 'swipe', x: 100, y: 500, direction: 'up', distance: 240 })
    const moves = send.mock.calls
      .map(([, payload]) => payload as { type: string; touchPoints: Array<{ y: number }> })
      .filter((payload) => payload.type === 'touchMove')
    expect(moves.length).toBeGreaterThan(3)
    expect(moves.at(-1)?.touchPoints[0].y).toBe(260)
  })

  it('долгое нажатие держит палец, а не отпускает сразу', async () => {
    const { page, send } = fakePage()
    const started = Date.now()
    await runTouchAction(page, { gesture: 'long-press', x: 5, y: 5, ms: 120 })
    expect(Date.now() - started).toBeGreaterThanOrEqual(110)
    expect(send).toHaveBeenCalledWith('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  })

  it('без цели жест отказывается словами', async () => {
    const { page } = fakePage()
    await expect(runTouchAction(page, { gesture: 'tap' })).rejects.toThrow('selector')
  })

  it('невидимый элемент — это отказ, а не касание в углу экрана', async () => {
    const { page } = fakePage(null)
    await expect(runTouchAction(page, { gesture: 'tap', selector: '#hidden' })).rejects.toThrow('не найден')
  })
})

it('мышиные события не превращаются в тач: иначе обычный клик перестаёт доходить', async () => {
  const { page, send } = fakePage()
  await applyDevice(page, { preset: 'phone' })
  expect(send).toHaveBeenCalledWith('Emulation.setEmitTouchEventsForMouse', { enabled: false, configuration: 'desktop' })
})
