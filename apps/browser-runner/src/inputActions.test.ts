import { expect, it, vi } from 'vitest'
import type { Page } from 'playwright'
import { runBrowserInput } from './inputActions.js'
it('долгий ввод не пропускает следующий символ вперёд', async () => {
  let release!: () => void
  const type = vi
    .fn()
    .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    .mockResolvedValue(undefined)
  const page = { keyboard: { type } } as unknown as Page
  const first = runBrowserInput(page, { type: 'type', text: 'a' })
  const second = runBrowserInput(page, { type: 'type', text: 'b' })
  await vi.waitFor(() => expect(type).toHaveBeenCalledTimes(1))
  release()
  await Promise.all([first, second])
  expect(type.mock.calls).toEqual([['a'], ['b']])
})
it('ошибка одного ввода не блокирует очередь навсегда', async () => {
  const type = vi.fn().mockRejectedValueOnce(new Error('страница занята')).mockResolvedValue(undefined)
  const page = { keyboard: { type } } as unknown as Page
  const first = runBrowserInput(page, { type: 'type', text: 'a' })
  const second = runBrowserInput(page, { type: 'type', text: 'b' })
  const result = await Promise.allSettled([first, second])
  expect(result.map((x) => x.status)).toEqual(['rejected', 'fulfilled'])
  expect(type.mock.calls).toEqual([['a'], ['b']])
})
it('модификатор снимается после отказа клика', async () => {
  const down = vi.fn(async () => {}),
    up = vi.fn(async () => {})
  const page = {
    keyboard: { down, up },
    mouse: {
      click: vi.fn(async () => {
        throw new Error('закрыта')
      })
    }
  } as unknown as Page
  await expect(runBrowserInput(page, { type: 'click', x: 1, y: 1, modifiers: ['Shift'] })).rejects.toThrow('закрыта')
  expect(up).toHaveBeenCalledWith('Shift')
})
it('ранее удерживаемый Shift сохраняется после модифицированного клика', async () => {
  const down = vi.fn(async () => {}),
    up = vi.fn(async () => {})
  const page = { keyboard: { down, up }, mouse: { click: vi.fn(async () => {}) } } as unknown as Page
  await runBrowserInput(page, { type: 'keyDown', key: 'Shift' })
  await runBrowserInput(page, { type: 'click', x: 1, y: 1, modifiers: ['Shift'] })
  expect(up).not.toHaveBeenCalled()
  await runBrowserInput(page, { type: 'keyUp', key: 'Shift' })
  expect(up).toHaveBeenCalledTimes(1)
})
it('разные страницы не задерживают ввод друг друга', async () => {
  let release!: () => void
  const a = { keyboard: { type: () => new Promise<void>((r) => (release = r)) } } as unknown as Page
  const type = vi.fn(async () => {})
  const b = { keyboard: { type } } as unknown as Page
  const first = runBrowserInput(a, { type: 'type', text: 'a' })
  await runBrowserInput(b, { type: 'type', text: 'b' })
  expect(type).toHaveBeenCalledWith('b')
  release()
  await first
})

it.each([
  { type: 'wheel', x: 100, deltaX: 0, deltaY: 10 },
  { type: 'wheel', x: NaN, y: 10, deltaX: 0, deltaY: 10 },
  { type: 'click', x: 1, y: 1, detail: 3 },
  { type: 'click', x: 1, y: 1, modifiers: ['Unknown'] }
])('ошибочные расширения ввода отвергаются до движения мыши: %j', async (action) => {
  const move = vi.fn(),
    click = vi.fn()
  const page = { mouse: { move, click } } as unknown as Page
  await expect(runBrowserInput(page, action as never)).rejects.toThrow()
  expect(move).not.toHaveBeenCalled()
  expect(click).not.toHaveBeenCalled()
})
