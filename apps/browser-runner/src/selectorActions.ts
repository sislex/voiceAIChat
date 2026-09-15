import { BROWSER_UPLOAD_LIMIT_BYTES, isBrowserWaitOptions, type BrowserElementDescription, type BrowserSelectorAction, type BrowserSelectorResult } from '@voicechat/shared'
import { describeElementScript } from './describeElement.js'
import { findElements, readPage, readBounds, type ReadContent } from './pageReading.js'
import { readElementTargets } from './elementTargets.js'
import { focusOrderScript, focusStateScript, pasteScript, selectElementScript, selectionScript } from './focusActions.js'
import { dropFilesScript, formStateScript, optionsScript, submitScript, validityScript } from './formActions.js'
import { highlightScript, listScript, measureScript, pageMetricsScript, scrollStepScript, tableScript } from './contentActions.js'
import { mediaScript } from './environmentActions.js'
import { waitForConditions, type WaitLocator, type WaitPage } from './waiting.js'

/**
 * Минимум от Playwright, который нужен селекторным действиям. Узкий тип вместо
 * `Page` — чтобы логику можно было проверить без Chromium: тесты подставляют
 * фейковые локаторы.
 */
export interface SelectorLocator extends WaitLocator {
  first(): SelectorLocator
  all(): Promise<SelectorLocator[]>
  filter(options: { visible?: boolean; hasText?: string }): SelectorLocator
  evaluateAll(script: string | ((nodes: unknown[], arg: unknown) => unknown), arg?: unknown): Promise<unknown>
  click(options?: { timeout?: number; button?: 'left' | 'right'; clickCount?: number; modifiers?: Array<'Shift' | 'Control' | 'Alt' | 'Meta'> }): Promise<void>
  press(key: string, options?: { timeout?: number }): Promise<void>
  pressSequentially(text: string, options?: { timeout?: number; delay?: number }): Promise<void>
  focus(options?: { timeout?: number }): Promise<void>
  clear(options?: { timeout?: number }): Promise<void>
  selectText(options?: { timeout?: number }): Promise<void>
  fill(value: string, options?: { timeout?: number }): Promise<void>
  innerText(options?: { timeout?: number }): Promise<string>
  isVisible(): Promise<boolean>
  waitFor(options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<void>
  hover(options?: { timeout?: number }): Promise<void>
  selectOption(value: string | string[], options?: { timeout?: number }): Promise<unknown>
  check(options?: { timeout?: number }): Promise<void>
  uncheck(options?: { timeout?: number }): Promise<void>
  dragTo(target: SelectorLocator, options?: { timeout?: number }): Promise<void>
  scrollIntoViewIfNeeded(options?: { timeout?: number }): Promise<void>
  ariaSnapshot(options?: { timeout?: number }): Promise<string>
  evaluate(fn: string | ((node: unknown, arg: unknown) => unknown), arg?: unknown, options?: { timeout?: number }): Promise<unknown>
  setInputFiles(files: { name: string; mimeType: string; buffer: Buffer } | Array<{ name: string; mimeType: string; buffer: Buffer }>, options?: { timeout?: number }): Promise<void>
}
export interface SelectorPage extends WaitPage {
  locator(selector: string): SelectorLocator
  getByText(text: string, options?: { exact?: boolean }): SelectorLocator
  keyboard: { press(key: string): Promise<void>; down?(key: string): Promise<void>; up?(key: string): Promise<void> }
  /** Код строкой: описание элемента и прокрутка исполняются в самой странице. */
  evaluate(script: string): Promise<unknown>
}

/**
 * Селекторные действия модели. Раньше раннер понимал только координаты, и
 * MCP-инструменты (они селекторные) до изолированного Chromium не доставали.
 * Каждое действие — один локатор Playwright; ошибка возвращается значением, а
 * не исключением: модель должна увидеть причину, а не «команда не выполнена».
 */
/** Потолок загрузки: содержимое едет в JSON, base64 раздувает его на треть. */
const UPLOAD_LIMIT_BYTES = BROWSER_UPLOAD_LIMIT_BYTES

/**
 * base64 от модели → байты. Buffer.from молча пропускает мусор, и без проверки
 * страница получала другой файл, а модель — ok. Проверяем до выделения памяти;
 * файл нулевой длины допустим.
 */
function decodeUpload(raw: string): { buffer: Buffer } | { error: string } {
  const encoded = raw.replace(/\s/g, '')
  if (encoded.length > Math.ceil(UPLOAD_LIMIT_BYTES / 3) * 4) return { error: 'Файл больше 8 МБ' }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1 || (encoded.includes('=') && encoded.length % 4 !== 0)) return { error: 'Некорректное содержимое base64' }
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) return { error: 'Некорректное содержимое base64' }
  if (buffer.length > UPLOAD_LIMIT_BYTES) return { error: `Файл больше ${Math.round(UPLOAD_LIMIT_BYTES / 1024 / 1024)} МБ` }
  return { buffer }
}

/** Selected text returned to the model; longer selections are cut with a flag. */
const SELECTION_LIMIT = 4_000

/** Keystroke repeat: a held key, bounded so one call cannot run away. */
function repeatOf(value: number | undefined): number {
  return value === undefined ? 1 : Math.min(Math.max(Math.trunc(value), 1), 50)
}

function selection(raw: unknown): BrowserSelectorResult {
  const text = typeof raw === 'string' ? raw : ''
  return text.length > SELECTION_LIMIT
    ? { ok: true, selection: { text: text.slice(0, SELECTION_LIMIT), truncated: true } }
    : { ok: true, selection: { text } }
}

/** Отказываем при неоднозначности: порядок DOM не выражает намерение модели. */
export async function uniqueTarget(target: SelectorLocator, timeout: number, hiddenAllowed = false): Promise<SelectorLocator> {
  const deadline = Date.now() + timeout
  const strict = hiddenAllowed ? target : target.filter({ visible: true })
  do {
    const count = await strict.count()
    if (count > 1) throw new Error(`Найдено несколько доступных элементов (${count}). Уточните селектор через find.`)
    if (count === 1) {
      // Копия DOM с тем же атрибутом не является исходным найденным узлом.
      const valid = await strict.evaluate(node => {
        const element = node as { getAttribute(name: string): string | null }
        const ref = element.getAttribute('data-voicechat-reader-ref')
        const state = (globalThis as unknown as { __voicechatReaderReferences?: { nodes: WeakMap<object, string> } }).__voicechatReaderReferences
        return !ref || state?.nodes.get(element) === ref
      })
      if (valid === false) throw new Error('stale_element_ref: Найдите элемент заново через find')
      return strict
    }
    if (Date.now() >= deadline) break
    await new Promise(resolve => setTimeout(resolve, Math.min(40, Math.max(0, deadline - Date.now()))))
  } while (Date.now() <= deadline)
  throw new Error(hiddenAllowed ? 'Элемент не найден' : 'Доступный элемент не найден')
}

export async function runSelectorAction(page: SelectorPage, action: BrowserSelectorAction, publicUrl: (raw: string) => string = raw => raw): Promise<BrowserSelectorResult> {
  const timeout = 'timeoutMs' in action && typeof action.timeoutMs === 'number' ? Math.min(Math.max(action.timeoutMs, 100), 30_000) : 5_000
  const locate = (selector?: string, text?: string): SelectorLocator | null =>
    selector ? (text ? page.locator(selector).filter({ hasText: text }) : page.locator(selector)) : text ? page.getByText(text, { exact: false }) : null
  try {
    if (action.kind === 'wait') {
      if (!isBrowserWaitOptions(action)) return { ok: false, error: 'Некорректные или несовместимые условия ожидания' }
      const started = performance.now()
      if ((action.selector || action.text) && action.count === undefined && (action.state === undefined || action.state === 'visible')) {
        await uniqueTarget(locate(action.selector, action.text)!, timeout)
      }
      const result = await waitForConditions(page, { ...action, timeoutMs: Math.max(1, Math.ceil(timeout - (performance.now() - started))) }, publicUrl)
      return { ...result, waitedMs: Math.round(performance.now() - started) }
    }
    if (action.kind === 'click') {
      const target = locate(action.selector, action.text)
      if (!target) return { ok: false, error: 'Нужен selector или text' }
      await (await uniqueTarget(target, timeout)).click({ timeout, button: action.button ?? 'left', clickCount: action.clickCount ?? 1, ...(action.modifiers ? { modifiers: action.modifiers } : {}) })
      return { ok: true }
    }
    if (action.kind === 'press') {
      const target = await uniqueTarget(page.locator(action.selector), timeout)
      // Playwright spells a shortcut as "Control+a"; the model names the parts
      // separately, because it also needs them for the keyboard-only input path.
      const key = [...(action.modifiers ?? []), action.key].join('+')
      for (let time = 0; time < repeatOf(action.repeat); time++) await target.press(key, { timeout })
      return { ok: true }
    }
    if (action.kind === 'focus') {
      // No selector: report where focus is, do not move it. Tab-walking a form
      // is a read-then-act loop, and moving focus to answer would break it.
      if (action.selector) await (await uniqueTarget(page.locator(action.selector), timeout)).focus({ timeout })
      return await readElementTargets(page, async () => {
        const state = await page.evaluate(focusStateScript()) as BrowserSelectorResult['focus']
        return { ok: true, ...(state ? { focus: state } : {}) }
      })
    }
    if (action.kind === 'clear') {
      await (await uniqueTarget(page.locator(action.selector), timeout)).clear({ timeout })
      return { ok: true }
    }
    if (action.kind === 'selectText') {
      if (action.selector) {
        const target = await uniqueTarget(page.locator(action.selector), timeout)
        // Playwright's selectText covers text nodes; inputs need their own select().
        try { await target.selectText({ timeout }) } catch { await target.evaluate(selectElementScript(), undefined, { timeout }) }
      } else await page.evaluate(`(() => { const range = document.createRange(); range.selectNodeContents(document.body); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return true })()`)
      return selection(await page.evaluate(selectionScript(SELECTION_LIMIT)))
    }
    if (action.kind === 'copy') return selection(await page.evaluate(selectionScript(SELECTION_LIMIT)))
    if (action.kind === 'focusOrder') {
      const limit = Math.min(Math.max(action.limit ?? 50, 1), 200)
      return await readElementTargets(page, async () => {
        const walk = await page.evaluate(focusOrderScript(action.selector ?? null, limit)) as { total: number; items: NonNullable<BrowserSelectorResult['focusOrder']> } | null
        if (!walk) return { ok: false, error: 'Элемент не найден' }
        return { ok: true, focusOrder: walk.items, total: walk.total, ...(walk.total > walk.items.length ? { truncated: true } : {}) }
      })
    }
    if (action.kind === 'paste') {
      const target = await uniqueTarget(page.locator(action.selector || ':focus'), timeout)
      const done = await target.evaluate(pasteScript(), action.text, { timeout })
      return done === false ? { ok: false, error: 'Элемент не принимает вставку текста' } : { ok: true }
    }
    if (action.kind === 'scroll') {
      // document.scrollingElement и вложенный контейнер имеют разные позиции.
      // Ждём два кадра, чтобы scroll-событие уже увидели обработчики страницы.
      const target = await uniqueTarget(page.locator(action.selector || 'body'), timeout)
      const scrolled = await target.evaluate((element, value) => {
        const scope = globalThis as unknown as {
          document: { body: unknown; documentElement: unknown; scrollingElement: unknown }
          requestAnimationFrame(callback: () => void): void
        }
        const node = (element === scope.document.body || element === scope.document.documentElement ? scope.document.scrollingElement : element) as {
          scrollTop: number; scrollLeft: number; scrollHeight: number; scrollWidth: number; clientWidth: number; clientHeight: number; scrollTo(options: { top: number; left: number; behavior: string }): void
        }
        const options = value as { to?: 'top' | 'bottom'; dy: number; dx: number }
        const top = options.to === 'top' ? 0 : options.to === 'bottom' ? node.scrollHeight : node.scrollTop + options.dy
        node.scrollTo({ top, left: node.scrollLeft + options.dx, behavior: 'instant' })
        return new Promise(resolve => scope.requestAnimationFrame(() => scope.requestAnimationFrame(() => resolve({ top: node.scrollTop, left: node.scrollLeft, maxTop: Math.max(0, node.scrollHeight - node.clientHeight), maxLeft: Math.max(0, node.scrollWidth - node.clientWidth) }))))
      }, { to: action.to, dy: action.dy ?? (action.dx === undefined ? 400 : 0), dx: action.dx ?? 0 }, { timeout })
      return { ok: true, scrolled: scrolled as BrowserSelectorResult['scrolled'] }
    }
    if (action.kind === 'type') {
      const target = await uniqueTarget(page.locator(action.selector), timeout)
      // fill() sets the value in one go: autocomplete, debounced search and
      // maxlength-per-keystroke logic never see the keys a person would press.
      if (typeof action.delay === 'number') {
        await target.clear({ timeout })
        await target.pressSequentially(action.text, { timeout, delay: Math.min(Math.max(action.delay, 0), 200) })
      } else await target.fill(action.text, { timeout })
      if (action.submit) await page.keyboard.press('Enter')
      return { ok: true }
    }
    if (action.kind === 'read') {
      const options = readBounds(action.limit, action.offset)
      const target = await uniqueTarget(page.locator(action.selector || 'body'), timeout)
      return await readElementTargets(page, async () => ({ ok: true, ...await target.evaluate(readPage, options, { timeout }) as ReadContent }))
    }
    if (action.kind === 'hover') {
      const target = locate(action.selector, action.text)
      if (!target) return { ok: false, error: 'Нужен selector или text' }
      await (await uniqueTarget(target, timeout)).hover({ timeout })
      return { ok: true }
    }
    if (action.kind === 'set') {
      // Три разных контрола под одним действием: `type` не берёт ни один из них.
      const target = await uniqueTarget(page.locator(action.selector), timeout)
      if (typeof action.checked === 'boolean') {
        await (action.checked ? target.check({ timeout }) : target.uncheck({ timeout }))
        return { ok: true }
      }
      if (action.values) {
        // Multi-select: a person ctrl-clicks several options, and setting them
        // one by one would clear the previous choice each time.
        await target.selectOption(action.values, { timeout })
        return { ok: true }
      }
      if (typeof action.value !== 'string') return { ok: false, error: 'Нужен value или checked' }
      // select отличаем от текстового поля по факту: сначала пробуем как select,
      // и только на отказе — как поле ввода.
      try { await target.selectOption(action.value, { timeout }); return { ok: true } }
      catch { await target.fill(action.value, { timeout }); return { ok: true } }
    }
    if (action.kind === 'drag') {
      await (await uniqueTarget(page.locator(action.from), timeout)).dragTo(await uniqueTarget(page.locator(action.to), timeout), { timeout })
      return { ok: true }
    }
    if (action.kind === 'upload') {
      // Файл приходит base64 и уходит в память Playwright: писать его на диск
      // раннера незачем, а вот ограничить размер — обязательно.
      const sources = action.files?.length ? action.files : [{ name: action.name, mimeType: action.mimeType, base64: action.base64 }]
      const files: Array<{ name: string; mimeType: string; buffer: Buffer }> = []
      let total = 0
      for (const source of sources) {
        const decoded = decodeUpload(source.base64)
        if ('error' in decoded) return { ok: false, error: decoded.error }
        total += decoded.buffer.length
        if (total > UPLOAD_LIMIT_BYTES) return { ok: false, error: `Файлы вместе больше ${Math.round(UPLOAD_LIMIT_BYTES / 1024 / 1024)} МБ` }
        files.push({ name: source.name, mimeType: source.mimeType || 'application/octet-stream', buffer: decoded.buffer })
      }
      const target = await uniqueTarget(page.locator(action.selector), timeout, true)
      await target.setInputFiles(files.length === 1 ? files[0] : files, { timeout })
      return { ok: true }
    }
    if (action.kind === 'fillForm') {
      // Заполняем по одному полю, но за один ход модели: форма, которая
      // перерисовывается между вызовами, иначе теряла всё введённое раньше.
      const filled: NonNullable<BrowserSelectorResult['filled']> = []
      for (const field of action.fields) {
        try {
          const node = await uniqueTarget(page.locator(field.selector), timeout)
          if (typeof field.checked === 'boolean') await (field.checked ? node.check({ timeout }) : node.uncheck({ timeout }))
          else if (field.values) await node.selectOption(field.values, { timeout })
          else if (typeof field.value === 'string') {
            try { await node.selectOption(field.value, { timeout }) }
            catch {
              if (typeof action.delay === 'number') { await node.clear({ timeout }); await node.pressSequentially(field.value, { timeout, delay: Math.min(Math.max(action.delay, 0), 200) }) }
              else await node.fill(field.value, { timeout })
            }
          } else { filled.push({ selector: field.selector, ok: false, error: 'Нужен value, values или checked' }); continue }
          filled.push({ selector: field.selector, ok: true })
        } catch (error) {
          filled.push({ selector: field.selector, ok: false, error: error instanceof Error ? error.message.split('\n')[0] : 'Поле не заполнено' })
        }
      }
      // Частично заполненная форма не должна читаться как успех: модель иначе
      // жмёт «Отправить» и разбирается уже с ошибками страницы.
      const failed = filled.filter((item) => !item.ok)
      return { ok: failed.length === 0, filled, ...(failed.length ? { error: `Не заполнено полей: ${failed.length}` } : {}) }
    }
    if (action.kind === 'formState') {
      const limit = Math.min(Math.max(action.limit ?? 50, 1), 200)
      return await readElementTargets(page, async () => {
        const form = await page.evaluate(formStateScript(action.selector ?? null, limit)) as BrowserSelectorResult['form'] | null
        return form ? { ok: true, form } : { ok: false, error: 'Форма не найдена' }
      })
    }
    if (action.kind === 'validity') {
      return await readElementTargets(page, async () => {
        const validity = await page.evaluate(validityScript(action.selector ?? null)) as BrowserSelectorResult['validity'] | null
        return validity ? { ok: true, validity } : { ok: false, error: 'Форма не найдена' }
      })
    }
    if (action.kind === 'submit') {
      const target = await uniqueTarget(page.locator(action.selector || 'form'), timeout)
      const outcome = await target.evaluate(submitScript(), undefined, { timeout }) as { ok: boolean; error?: string }
      return outcome.ok ? { ok: true } : { ok: false, error: outcome.error ?? 'Форма не отправлена' }
    }
    if (action.kind === 'options') {
      const limit = Math.min(Math.max(action.limit ?? 100, 1), 500)
      const options = await page.evaluate(optionsScript(action.selector, limit)) as BrowserSelectorResult['options'] | null
      return options ? { ok: true, options } : { ok: false, error: 'У этого элемента нет вариантов выбора: это не select, не поле с datalist и не группа radio' }
    }
    if (action.kind === 'dropFile') {
      const files: Array<{ name: string; mimeType: string; base64: string }> = []
      for (const file of action.files) {
        const decoded = decodeUpload(file.base64)
        if ('error' in decoded) return { ok: false, error: decoded.error }
        files.push({ name: file.name, mimeType: file.mimeType || 'application/octet-stream', base64: decoded.buffer.toString('base64') })
      }
      const target = await uniqueTarget(page.locator(action.selector), timeout, true)
      const outcome = await target.evaluate(dropFilesScript(), files, { timeout }) as { ok: boolean }
      return outcome?.ok ? { ok: true } : { ok: false, error: 'Зона не приняла файлы' }
    }
    if (action.kind === 'count') {
      const target = locate(action.selector, action.text)
      if (!target) return { ok: false, error: 'Нужен selector или text' }
      const all = await target.count()
      const visible = await target.filter({ visible: true }).count()
      return { ok: true, total: action.visibleOnly === false ? all : visible, counted: { ...(action.selector ? { selector: action.selector } : {}), ...(action.text ? { text: action.text } : {}), visible, all } }
    }
    if (action.kind === 'metrics') {
      const metrics = await page.evaluate(pageMetricsScript()) as BrowserSelectorResult['metrics']
      return { ok: true, ...(metrics ? { metrics } : {}) }
    }
    if (action.kind === 'measure') {
      return await readElementTargets(page, async () => {
        const measured = await page.evaluate(measureScript(action.selector)) as BrowserSelectorResult['measured'] | null
        return measured ? { ok: true, measured } : { ok: false, error: 'Элемент не найден' }
      })
    }
    if (action.kind === 'highlight') {
      const ms = Math.min(Math.max(action.ms ?? 1500, 100), 10_000)
      const shown = await page.evaluate(highlightScript(action.selector, ms))
      return shown ? { ok: true } : { ok: false, error: 'Элемент не найден' }
    }
    if (action.kind === 'media') {
      const media = await page.evaluate(mediaScript(action.selector ?? null, action.do ?? null, action.seconds ?? null)) as NonNullable<BrowserSelectorResult['media']> | { error: string } | null
      if (!media) return { ok: false, error: 'На странице нет видео или аудио' }
      if (!Array.isArray(media)) return { ok: false, error: `Воспроизведение отклонено страницей: ${media.error}` }
      return { ok: true, media }
    }
    if (action.kind === 'table') {
      const offset = Math.max(action.offset ?? 0, 0)
      const limit = Math.min(Math.max(action.limit ?? 20, 1), 200)
      const table = await page.evaluate(tableScript(action.selector, offset, limit, action.columns ?? null)) as BrowserSelectorResult['table'] | null
      return table ? { ok: true, table } : { ok: false, error: 'Таблица не найдена или в ней нет строк' }
    }
    if (action.kind === 'list') {
      const offset = Math.max(action.offset ?? 0, 0)
      const limit = Math.min(Math.max(action.limit ?? 20, 1), 100)
      return await readElementTargets(page, async () => {
        const list = await page.evaluate(listScript(action.selector, offset, limit)) as BrowserSelectorResult['list'] | null
        return list ? { ok: true, list } : { ok: false, error: 'По этому селектору нет блоков' }
      })
    }
    if (action.kind === 'scrollUntil') {
      // Слепая прокрутка колесом на ленивой ленте либо останавливалась на первом
      // экране, либо крутилась бесконечно: раннер не знал, грузится ли ещё что-то.
      const target = locate(action.selector, action.text)
      if (!target) return { ok: false, error: 'Нужен selector или text' }
      const maxScrolls = Math.min(Math.max(action.maxScrolls ?? 10, 1), 50)
      const step = Math.min(Math.max(action.step ?? 800, 1), 10_000)
      let scrolls = 0, atBottom = false, top = 0
      for (; scrolls <= maxScrolls; scrolls++) {
        if (await target.filter({ visible: true }).count() > 0) return { ok: true, scrolledUntil: { found: true, scrolls, atBottom, top } }
        if (atBottom) break
        const moved = await page.evaluate(scrollStepScript(action.container ?? null, step)) as { moved: number; top: number; atBottom: boolean } | null
        if (!moved) return { ok: false, error: 'Контейнер прокрутки не найден' }
        atBottom = moved.atBottom
        top = moved.top
        // Лента подгружает содержимое после прокрутки: без паузы следующий шаг
        // уходит в ещё не выросшую страницу и упирается в тот же низ.
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      const found = await target.filter({ visible: true }).count() > 0
      return found
        ? { ok: true, scrolledUntil: { found, scrolls, atBottom, top } }
        : { ok: false, error: atBottom ? 'Дошли до конца ленты, цель не появилась' : `Цель не появилась за ${maxScrolls} прокруток`, scrolledUntil: { found, scrolls, atBottom, top } }
    }
    if (action.kind === 'describe') {
      return await readElementTargets(page, async () => {
        const found = await page.evaluate(describeElementScript(action.x, action.y)) as BrowserElementDescription | null
        return found ? { ok: true, element: found } : { ok: false, error: 'В этой точке нет элемента' }
      })
    }
    if (action.kind === 'scrollTo') {
      const target = await uniqueTarget(page.locator(action.selector), timeout)
      await target.evaluate(node => (node as { scrollIntoView(options: { block: string; inline: string; behavior: string }): void }).scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
      return { ok: true }
    }
    if (action.kind === 'a11y') {
      const target = await uniqueTarget(page.locator(action.selector || 'body'), timeout)
      const snapshot = await target.ariaSnapshot({ timeout })
      const limit = Math.min(Math.max(action.limit ?? 4000, 100), 20_000)
      return snapshot.length > limit ? { ok: true, text: `${snapshot.slice(0, limit)}…`, truncated: true } : { ok: true, text: snapshot }
    }
    if (action.kind === 'find') {
      const target = locate(action.selector, action.text)
      if (!target) return { ok: false, error: 'Нужен selector или text' }
      const limit = Math.min(Math.max(action.limit ?? 10, 1), 50)
      const filtered = action.visibleOnly !== false ? target.filter({ visible: true }) : target
      return await readElementTargets(page, async () => ({ ok: true, ...await filtered.evaluateAll(findElements, limit) as ReadContent }))
    }
    return { ok: false, error: 'Неизвестное селекторное действие' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : 'Действие не выполнено' }
  }
}
