import type { Page } from 'playwright'
import type { BrowserInputAction } from '@voicechat/shared'

type Modifier = 'Shift' | 'Control' | 'Alt' | 'Meta'
const queues = new WeakMap<Page, Promise<void>>()
const held = new WeakMap<Page, Set<string>>()

/** Составное действие не смешивается с соседним вводом: иначе Shift или drag
 * захватывает следующий клик/символ из параллельного HTTP-запроса. */
export function runBrowserInput(page: Page, action: BrowserInputAction): Promise<void> {
  const pending = (queues.get(page) ?? Promise.resolve()).catch(() => undefined).then(() => performInput(page, action))
  queues.set(page, pending)
  void pending
    .finally(() => {
      if (queues.get(page) === pending) queues.delete(page)
    })
    .catch(() => undefined)
  return pending
}

async function performInput(page: Page, action: BrowserInputAction): Promise<void> {
  const keys = held.get(page) ?? new Set<string>()
  held.set(page, keys)
  if (action.type === 'mouseMove') await page.mouse.move(action.x, action.y)
  else if (action.type === 'mouseDown' || action.type === 'mouseUp') {
    await page.mouse.move(action.x, action.y)
    await (action.type === 'mouseDown'
      ? page.mouse.down({ button: action.button })
      : page.mouse.up({ button: action.button }))
  } else if (action.type === 'click') {
    if (action.detail !== undefined && action.detail !== 1 && action.detail !== 2)
      throw new Error('detail: нужен 1 или 2')
    if (
      action.modifiers !== undefined &&
      (!Array.isArray(action.modifiers) ||
        action.modifiers.some((key) => !['Shift', 'Control', 'Alt', 'Meta'].includes(key)))
    )
      throw new Error('Некорректные модификаторы клика')
    const modifiers = [...new Set(action.modifiers ?? [])].filter((key) => !keys.has(key))
    const pressed: Modifier[] = []
    try {
      for (const key of modifiers) {
        await page.keyboard.down(key)
        pressed.push(key)
      }
      if (action.detail !== undefined) {
        await page.mouse.move(action.x, action.y)
        await page.mouse.down({ button: action.button, clickCount: action.detail })
        try {
          await page.mouse.up({ button: action.button, clickCount: action.detail })
        } catch (error) {
          await page.mouse.up({ button: action.button }).catch(() => undefined)
          throw error
        }
      } else await page.mouse.click(action.x, action.y, { button: action.button, clickCount: action.clickCount })
    } finally {
      for (const key of pressed.reverse()) await page.keyboard.up(key).catch(() => undefined)
    }
  } else if (action.type === 'wheel') {
    if (
      (action.x === undefined) !== (action.y === undefined) ||
      (action.x !== undefined && (!Number.isFinite(action.x) || !Number.isFinite(action.y)))
    )
      throw new Error('Колесо требует обе координаты x/y')
    if (typeof action.x === 'number' && typeof action.y === 'number') await page.mouse.move(action.x, action.y)
    await page.mouse.wheel(action.deltaX, action.deltaY)
  } else if (action.type === 'drag') {
    await page.mouse.move(action.from.x, action.from.y)
    await page.mouse.down()
    try {
      await page.mouse.move(action.to.x, action.to.y, { steps: 10 })
    } finally {
      await page.mouse.up()
    }
  } else if (action.type === 'type') await page.keyboard.type(action.text)
  else if (action.type === 'press') await page.keyboard.press(action.key)
  else if (action.type === 'keyDown') {
    await page.keyboard.down(action.key)
    keys.add(action.key)
  } else if (action.type === 'keyUp') {
    await page.keyboard.up(action.key)
    keys.delete(action.key)
  } else throw new Error('Неизвестное действие ввода')
}
