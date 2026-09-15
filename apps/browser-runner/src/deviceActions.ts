import type { CDPSession, Page } from 'playwright'
import type { BrowserDeviceOptions, BrowserDeviceState, BrowserTouchAction } from '@voicechat/shared'

/**
 * Настоящий мобильный веб, а не узкое окно десктопа.
 *
 * «Телефон» в панели до сих пор означал только ширину: страница верстается как
 * мобильная, но `navigator.maxTouchPoints` равен нулю, `pointer: coarse` не
 * срабатывает, а `devicePixelRatio` остаётся единицей. Ровно на этом ломаются
 * карусели, меню «по наведению» и всё, что различает палец и мышь, — и такие
 * дефекты не находились вовсе.
 *
 * Playwright задаёт `hasTouch`/`isMobile` только при создании контекста, а у
 * нас контекст персистентный (в нём живёт авторизация сессии). Поэтому всё
 * делается через CDP-эмуляцию, которая работает на живой странице.
 */

/** Пресеты: те же размеры, на которых смотрят свои экраны. */
export const DEVICE_PRESETS: Record<string, { width: number; height: number; deviceScaleFactor: number; mobile: boolean; userAgent?: string }> = {
  phone: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'phone-android': { width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' },
  tablet: { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }
}

/**
 * CDP-сессия живёт вместе со страницей и не отсоединяется: `Emulation.*`
 * привязан к сессии, и `detach()` снимает всю эмуляцию — телефон превращался
 * обратно в десктоп ровно в тот момент, когда команда отвечала «готово».
 */
const sessions = new WeakMap<Page, Promise<CDPSession>>()

function emulationSession(page: Page): Promise<CDPSession> {
  let pending = sessions.get(page)
  if (!pending) {
    pending = page.context().newCDPSession(page)
    sessions.set(page, pending)
    page.once('close', () => sessions.delete(page))
  }
  return pending
}

export async function applyDevice(page: Page, options: BrowserDeviceOptions): Promise<BrowserDeviceState> {
  const preset = options.preset ? DEVICE_PRESETS[options.preset] : undefined
  if (options.preset && !preset) throw new Error(`Неизвестное устройство: ${options.preset}. Доступны: ${Object.keys(DEVICE_PRESETS).join(', ')}`)
  const base = preset ?? DEVICE_PRESETS.desktop
  const landscape = options.orientation === 'landscape'
  const width = options.width ?? (landscape ? base.height : base.width)
  const height = options.height ?? (landscape ? base.width : base.height)
  const deviceScaleFactor = options.deviceScaleFactor ?? base.deviceScaleFactor
  const mobile = options.touch ?? base.mobile
  // Порядок важен: `setViewportSize` внутри сам шлёт `setDeviceMetricsOverride`
  // со своими параметрами и затирает эмуляцию тача и плотности пикселей. Поэтому
  // сначала размер окна (его сохраняет профиль сессии), и только потом — CDP.
  await page.setViewportSize({ width, height }).catch(() => undefined)
  const session = await emulationSession(page)
  await session.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor, mobile,
    screenOrientation: { type: landscape ? 'landscapePrimary' : 'portraitPrimary', angle: landscape ? 90 : 0 }
  })
  // Без обеих команд `maxTouchPoints` остаётся нулевым, и страница считает
  // посетителя мышью — то самое, из-за чего мобильные дефекты не находились.
  // maxTouchPoints передаётся только при включении: Chromium требует 1…16 и
  // отвергает ноль протокольной ошибкой.
  await session.send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false })
  // `setEmitTouchEventsForMouse` намеренно не включается: он превращает мышиные
  // события в тач, и обычный клик Playwright (а с ним и клик человека в панели)
  // перестаёт доходить до страницы — E2E ловил это таймаутом locator.click.
  // Тач-эмуляции хватает `setTouchEmulationEnabled`: maxTouchPoints и
  // `pointer: coarse` страница уже видит, а настоящие жесты идут
  // `Input.dispatchTouchEvent` из `runTouchAction`.
  await session.send('Emulation.setEmitTouchEventsForMouse', { enabled: false, configuration: 'desktop' }).catch(() => undefined)
  const userAgent = options.userAgent ?? base.userAgent
  await session.send('Emulation.setUserAgentOverride', { userAgent: userAgent ?? '' }).catch(() => undefined)
  return {
    ...(options.preset ? { preset: options.preset } : {}),
    width, height, deviceScaleFactor, touch: mobile,
    orientation: landscape ? 'landscape' : 'portrait',
    ...(options.userAgent ?? base.userAgent ? { userAgent: options.userAgent ?? base.userAgent } : {})
  }
}

/** Точка касания: селектор превращается в координаты центра элемента. */
async function pointOf(page: Page, action: BrowserTouchAction): Promise<{ x: number; y: number }> {
  if (typeof action.x === 'number' && typeof action.y === 'number') return { x: action.x, y: action.y }
  if (!action.selector) throw new Error('Нужен selector или координаты x/y')
  const box = await page.locator(action.selector).first().boundingBox({ timeout: 5_000 })
  if (!box) throw new Error('Элемент не найден или не виден')
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
}

/**
 * Жесты пальцем. Мышиный клик и тап — разные события: страницы вешают на них
 * разные обработчики, и «работает у меня мышью» ничего не говорит о телефоне.
 */
export async function runTouchAction(page: Page, action: BrowserTouchAction): Promise<{ ok: true; point: { x: number; y: number } }> {
  const point = await pointOf(page, action)
  const session = await emulationSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', at: { x: number; y: number } | null) =>
    session.send('Input.dispatchTouchEvent', { type, touchPoints: at ? [{ x: at.x, y: at.y }] : [] })
  {
    if (action.gesture === 'tap') {
      await touch('touchStart', point)
      await touch('touchEnd', null)
    } else if (action.gesture === 'long-press') {
      await touch('touchStart', point)
      // Долгое нажатие — это именно пауза с прижатым пальцем: контекстное меню
      // и «выделить текст» на телефоне открываются только так.
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(action.ms ?? 600, 100), 5_000)))
      await touch('touchEnd', null)
    } else {
      const distance = Math.min(Math.max(action.distance ?? 300, 10), 4_000)
      const direction = action.direction ?? 'up'
      const delta = direction === 'up' ? { x: 0, y: -distance } : direction === 'down' ? { x: 0, y: distance }
        : direction === 'left' ? { x: -distance, y: 0 } : { x: distance, y: 0 }
      await touch('touchStart', point)
      // Шагами, а не одним прыжком: страница со «свайпом для удаления» считает
      // мгновенный перенос пальца сбоем и жест не засчитывает.
      const steps = 8
      for (let step = 1; step <= steps; step++) {
        await touch('touchMove', { x: Math.round(point.x + (delta.x * step) / steps), y: Math.round(point.y + (delta.y * step) / steps) })
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      await touch('touchEnd', null)
    }
  }
  return { ok: true, point }
}
