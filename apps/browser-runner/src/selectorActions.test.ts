// Селекторные действия модели: до этого раннер понимал только координаты, и
// MCP-инструменты (они селекторные) до изолированного Chromium не доставали.
// Логика вынесена из sessionManager отдельно, чтобы проверяться без Chromium.

import { describe, it, expect, vi } from 'vitest'
import { runSelectorAction, type SelectorLocator, type SelectorPage } from './selectorActions'

function locator(over: Partial<SelectorLocator> = {}): SelectorLocator {
  const self: SelectorLocator = {
    first: () => self,
    all: async () => [self],
    count: async () => (await self.all()).length,
    isEnabled: async () => true,
    isEditable: async () => true,
    isChecked: async () => false,
    inputValue: async () => '',
    boundingBox: async () => ({ x: 0, y: 0, width: 10, height: 10 }),
    filter: () => self,
    evaluateAll: async () => null,
    click: vi.fn(async () => {}),
    press: vi.fn(async () => {}),
    pressSequentially: vi.fn(async () => {}),
    focus: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    selectText: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    innerText: async () => 'Текст узла',
    isVisible: async () => true,
    waitFor: vi.fn(async () => {}),
    hover: vi.fn(async () => {}),
    selectOption: vi.fn(async () => []),
    check: vi.fn(async () => {}),
    uncheck: vi.fn(async () => {}),
    dragTo: vi.fn(async () => {}),
    scrollIntoViewIfNeeded: vi.fn(async () => {}),
    ariaSnapshot: async () => '- button "Создать"',
    evaluate: async () => null,
    setInputFiles: vi.fn(async () => {}),
    ...over
  }
  return self
}

function page(target: SelectorLocator, over: Partial<SelectorPage> = {}): SelectorPage {
  return {
    locator: vi.fn(() => target),
    getByText: vi.fn(() => target),
    waitForURL: async () => {},
    waitForLoadState: async () => {},
    waitForFunction: async () => ({ dispose: async () => {} }),
    keyboard: { press: vi.fn(async () => {}) },
    evaluate: vi.fn(async () => null),
    ...over
  }
}

describe('селекторные действия раннера', () => {
  it('клик по селектору доходит до локатора с кнопкой и числом нажатий', async () => {
    const target = locator()
    const result = await runSelectorAction(page(target), { kind: 'click', selector: '#save', button: 'right', clickCount: 2 })
    expect(result.ok).toBe(true)
    expect(target.click).toHaveBeenCalledWith(expect.objectContaining({ button: 'right', clickCount: 2 }))
  })

  it('клик по тексту работает, когда селектора нет', async () => {
    const target = locator()
    const p = page(target)
    await runSelectorAction(p, { kind: 'click', text: 'Отправить' })
    expect(p.getByText).toHaveBeenCalledWith('Отправить', { exact: false })
  })

  it('без селектора и текста действие отказывает понятной причиной, а не падает', async () => {
    const result = await runSelectorAction(page(locator()), { kind: 'click' })
    expect(result).toEqual({ ok: false, error: 'Нужен selector или text' })
  })

  it('ввод заполняет поле и по submit жмёт Enter', async () => {
    const target = locator()
    const p = page(target)
    await runSelectorAction(p, { kind: 'type', selector: '#q', text: 'привет', submit: true })
    expect(target.fill).toHaveBeenCalledWith('привет', expect.anything())
    expect(p.keyboard.press).toHaveBeenCalledWith('Enter')
  })

  // Чтение и поиск проверяются в readingActions.test.ts на живом DOM.

  it('ожидание ждёт видимости и отдаёт ошибку значением, а не исключением', async () => {
    const target = locator({ waitFor: vi.fn(async () => { throw new Error('Timeout 5000ms exceeded\nдетали') }) })
    const result = await runSelectorAction(page(target), { kind: 'wait', selector: '#late', timeoutMs: 200 })
    expect(result.ok).toBe(false)
    // Модель должна увидеть причину одной строкой, без стека Playwright.
    expect(result.error).toBe('Timeout 5000ms exceeded')
  })
})

describe('действия, которых у раннера не было (круг 9)', () => {
  it('hover доходит до локатора', async () => {
    const target = locator()
    expect(await runSelectorAction(page(target), { kind: 'hover', selector: '.menu' })).toEqual({ ok: true })
    expect(target.hover).toHaveBeenCalled()
  })

  it('set с checked ставит и снимает флажок', async () => {
    const target = locator()
    await runSelectorAction(page(target), { kind: 'set', selector: '#agree', checked: true })
    expect(target.check).toHaveBeenCalled()
    await runSelectorAction(page(target), { kind: 'set', selector: '#agree', checked: false })
    expect(target.uncheck).toHaveBeenCalled()
  })

  it('set с value сначала пробует select, а на отказе заполняет поле', async () => {
    const asSelect = locator()
    await runSelectorAction(page(asSelect), { kind: 'set', selector: '#role', value: 'owner' })
    expect(asSelect.selectOption).toHaveBeenCalledWith('owner', expect.anything())
    expect(asSelect.fill).not.toHaveBeenCalled()
    // Обычное поле ввода на selectOption отвечает исключением — значит, fill.
    const asInput = locator({ selectOption: vi.fn(async () => { throw new Error('Element is not a <select> element') }) })
    expect(await runSelectorAction(page(asInput), { kind: 'set', selector: '#date', value: '2026-08-29' })).toEqual({ ok: true })
    expect(asInput.fill).toHaveBeenCalledWith('2026-08-29', expect.anything())
  })

  it('set без value и checked объясняет, чего не хватает', async () => {
    expect(await runSelectorAction(page(locator()), { kind: 'set', selector: '#x' })).toEqual({ ok: false, error: 'Нужен value или checked' })
  })

  it('drag тянет один локатор к другому', async () => {
    const target = locator()
    expect(await runSelectorAction(page(target), { kind: 'drag', from: '.card', to: '.column' })).toEqual({ ok: true })
    expect(target.dragTo).toHaveBeenCalledWith(target, expect.anything())
  })

  it('a11y отдаёт снимок дерева ролей и режет его по лимиту', async () => {
    const short = await runSelectorAction(page(locator()), { kind: 'a11y' })
    expect(short).toEqual({ ok: true, text: '- button "Создать"' })
    const long = await runSelectorAction(page(locator({ ariaSnapshot: async () => 'x'.repeat(500) })), { kind: 'a11y', limit: 100 })
    expect(long.text).toHaveLength(101)
    expect(long.truncated).toBe(true)
  })

  it('ошибка Playwright возвращается значением, а не исключением', async () => {
    const target = locator({ hover: vi.fn(async () => { throw new Error('Timeout 5000ms exceeded\nCall log:\n  - waiting') }) })
    expect(await runSelectorAction(page(target), { kind: 'hover', selector: '.menu' })).toEqual({ ok: false, error: 'Timeout 5000ms exceeded' })
  })
})

describe('загрузка файла (круг 10)', () => {
  it('содержимое base64 уходит в setInputFiles с именем и типом', async () => {
    const target = locator()
    const result = await runSelectorAction(page(target), { kind: 'upload', selector: '#file', name: 'a.txt', mimeType: 'text/plain', base64: Buffer.from('привет').toString('base64') })
    expect(result).toEqual({ ok: true })
    expect(target.setInputFiles).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('привет') }),
      expect.anything()
    )
  })

  it('без типа подставляется нейтральный, пустой файл поддерживается', async () => {
    const target = locator()
    await runSelectorAction(page(target), { kind: 'upload', selector: '#f', name: 'a.bin', base64: 'AA==' })
    expect(target.setInputFiles).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'application/octet-stream' }), expect.anything())
    expect(await runSelectorAction(page(target), { kind: 'upload', selector: '#f', name: 'a', base64: '' })).toEqual({ ok: true })
    expect(target.setInputFiles).toHaveBeenLastCalledWith(expect.objectContaining({ buffer: Buffer.alloc(0) }), expect.anything())
  })

  it.each(['YWJj$', 'A', 'AB==', 'YWJj=', 'Y=Q='])('битый base64 %s отклоняется до выбора файла', async (base64) => {
    const target = locator()
    expect(await runSelectorAction(page(target), { kind: 'upload', selector: '#f', name: 'a', base64 })).toMatchObject({ ok: false, error: expect.stringMatching(/base64/) })
    expect(target.setInputFiles).not.toHaveBeenCalled()
  })

  it('принимает форматирование переносами строк и корректный base64 без padding', async () => {
    const target = locator()
    for (const base64 of ['aG\nk=', 'aGk']) expect(await runSelectorAction(page(target), { kind: 'upload', selector: '#f', name: 'a', base64 })).toMatchObject({ ok: true })
    expect(target.setInputFiles).toHaveBeenLastCalledWith(expect.objectContaining({ buffer: Buffer.from('hi') }), expect.anything())
  })

  it('слишком большой файл отклоняется до обращения к странице', async () => {
    const target = locator()
    const huge = Buffer.alloc(9 * 1024 * 1024).toString('base64')
    expect(await runSelectorAction(page(target), { kind: 'upload', selector: '#f', name: 'big.bin', base64: huge }))
      .toEqual({ ok: false, error: 'Файл больше 8 МБ' })
    expect(target.setInputFiles).not.toHaveBeenCalled()
  })
})

describe('описание элемента и прокрутка (круг 12)', () => {
  it('describe отдаёт элемент страницы как есть', async () => {
    const element = { selector: '[data-testid="create"]', stability: 'testid', tag: 'button', text: 'Создать', rect: { x: 1, y: 2, width: 100, height: 40 } }
    const result = await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => element) }), { kind: 'describe', x: 50, y: 30 })
    expect(result).toEqual({ ok: true, element })
  })

  it('точка без элемента объясняется, а не отдаёт пустоту', async () => {
    expect(await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => null) }), { kind: 'describe', x: 0, y: 0 }))
      .toEqual({ ok: false, error: 'В этой точке нет элемента' })
  })

  it('scrollTo сообщает, что элемента нет, а не молчит', async () => {
    expect(await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => true) }), { kind: 'scrollTo', selector: '#a' })).toEqual({ ok: true })
    expect(await runSelectorAction(page(locator({ evaluate: async () => { throw new Error('Элемент #нет не найден') } })), { kind: 'scrollTo', selector: '#нет' }))
      .toEqual({ ok: false, error: 'Элемент #нет не найден' })
  })
})

describe('однозначные цели', () => {
  it('не нажимает ни одну из двух видимых кнопок', async () => {
    const a = locator(), b = locator()
    const result = await runSelectorAction(page(locator({ all: async () => [a, b] })), { kind: 'click', selector: 'button' })
    expect(result.error).toContain('несколько')
    expect(a.click).not.toHaveBeenCalled()
    expect(b.click).not.toHaveBeenCalled()
  })
  it('пропускает скрытую копию поля', async () => {
    const hidden = locator({ isVisible: async () => false }), visible = locator()
    expect(await runSelectorAction(page(locator({ all: async () => [hidden, visible], filter: () => visible })), { kind: 'type', selector: 'input', text: 'ok' })).toEqual({ ok: true })
    expect(hidden.fill).not.toHaveBeenCalled()
    expect(visible.fill).toHaveBeenCalledWith('ok', expect.anything())
  })
  it('скрытый file input допустим, неоднозначный upload запрещён', async () => {
    const a = locator({ isVisible: async () => false }), b = locator()
    const action = { kind: 'upload' as const, selector: 'input', name: 'a', base64: 'YQ==' }
    expect(await runSelectorAction(page(a), action)).toEqual({ ok: true })
    expect((await runSelectorAction(page(locator({ all: async () => [a, b] })), action)).error).toContain('несколько')
  })
})

// Клавиатура и буфер обмена: круг 1 «модель работает как пользователь». Клик по
// элементу и переход на него фокусом — разные события, и ошибки клавиатурной
// доступности живут ровно в этой разнице.
describe('фокус, выделение и вставка', () => {
  it('focus с селектором ставит фокус и возвращает состояние активного элемента', async () => {
    const target = locator()
    const p = page(target, { evaluate: vi.fn(async () => ({ selector: '#login', tag: 'input', visibleRing: true, withinDialog: false })) })
    const result = await runSelectorAction(p, { kind: 'focus', selector: '#login' })
    expect(target.focus).toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, focus: { selector: '#login', visibleRing: true } })
  })

  it('focus без селектора только читает фокус и не двигает его', async () => {
    const target = locator()
    const p = page(target, { evaluate: vi.fn(async () => ({ none: true })) })
    const result = await runSelectorAction(p, { kind: 'focus' })
    expect(target.focus).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, focus: { none: true } })
  })

  it('clear очищает поле через clear(), а не записью пустого значения', async () => {
    const target = locator()
    await runSelectorAction(page(target), { kind: 'clear', selector: '#q' })
    expect(target.clear).toHaveBeenCalled()
    expect(target.fill).not.toHaveBeenCalled()
  })

  it('selectText берёт выделение элемента, а при отказе Playwright — через select() самой страницы', async () => {
    const target = locator({ selectText: vi.fn(async () => { throw new Error('not text node') }) })
    const p = page(target, { evaluate: vi.fn(async () => 'Выделенный текст') })
    const result = await runSelectorAction(p, { kind: 'selectText', selector: '#title' })
    expect(target.evaluate).toBeDefined()
    expect(result).toEqual({ ok: true, selection: { text: 'Выделенный текст' } })
  })

  it('copy возвращает выделение и честно помечает обрезку длинного текста', async () => {
    const long = 'я'.repeat(4_100)
    const result = await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => long) }), { kind: 'copy' })
    expect(result.selection?.truncated).toBe(true)
    expect(result.selection?.text.length).toBe(4_000)
  })

  it('paste отказывается словами, когда элемент не принимает вставку', async () => {
    // Первый evaluate — проверка живости узла внутри uniqueTarget, второй — сама вставка.
    let call = 0
    const target = locator({ evaluate: vi.fn(async () => (call++ === 0 ? true : false)) })
    const result = await runSelectorAction(page(target), { kind: 'paste', selector: '#note', text: 'привет' })
    expect(result).toEqual({ ok: false, error: 'Элемент не принимает вставку текста' })
  })

  it('paste без селектора целится в элемент в фокусе', async () => {
    const target = locator({ evaluate: vi.fn(async () => true) })
    const p = page(target)
    await runSelectorAction(p, { kind: 'paste', text: 'привет' })
    expect(target.evaluate).toHaveBeenCalled()
    expect(p.locator).toHaveBeenCalledWith(':focus')
  })

  it('press собирает сочетание из модификаторов и повторяет нажатие repeat раз', async () => {
    const target = locator()
    await runSelectorAction(page(target), { kind: 'press', selector: '#list', key: 'ArrowDown', modifiers: ['Shift'], repeat: 3 })
    expect(target.press).toHaveBeenCalledTimes(3)
    expect(target.press).toHaveBeenCalledWith('Shift+ArrowDown', expect.anything())
  })

  it('ввод с delay идёт посимвольно после очистки: иначе автодополнение не просыпается', async () => {
    const target = locator()
    await runSelectorAction(page(target), { kind: 'type', selector: '#q', text: 'дом', delay: 30 })
    expect(target.clear).toHaveBeenCalled()
    expect(target.pressSequentially).toHaveBeenCalledWith('дом', expect.objectContaining({ delay: 30 }))
    expect(target.fill).not.toHaveBeenCalled()
  })

  it('focus-order отдаёт обход по Tab и помечает, что список длиннее лимита', async () => {
    const walk = { total: 7, items: [{ selector: '#a', tag: 'a', name: 'Домой', tabIndex: 0, visible: true }] }
    const result = await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => walk) }), { kind: 'focusOrder', limit: 1 })
    expect(result).toMatchObject({ ok: true, total: 7, truncated: true })
    expect(result.focusOrder).toHaveLength(1)
  })

  it('focus-order на несуществующем поддереве отвечает отказом, а не пустым списком', async () => {
    const result = await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => null) }), { kind: 'focusOrder', selector: '#missing' })
    expect(result).toEqual({ ok: false, error: 'Элемент не найден' })
  })
})

// Круг 2: формы. Человек заполняет форму одним действием и видит, почему она не
// отправляется; модель до этого круга заполняла поле за вызов и узнавала причину
// отказа только по тому, что страница решила нарисовать.
describe('формы целиком', () => {
  it('fill-form заполняет поля по очереди и отчитывается по каждому', async () => {
    const target = locator()
    const result = await runSelectorAction(page(target), {
      kind: 'fillForm',
      fields: [{ selector: '#login', value: 'admin' }, { selector: '#remember', checked: true }]
    })
    expect(result.ok).toBe(true)
    expect(result.filled).toEqual([{ selector: '#login', ok: true }, { selector: '#remember', ok: true }])
    expect(target.check).toHaveBeenCalled()
  })

  it('частично заполненная форма не выдаётся за успех', async () => {
    const target = locator({ fill: vi.fn(async () => { throw new Error('поле только для чтения') }), selectOption: vi.fn(async () => { throw new Error('не select') }) })
    const result = await runSelectorAction(page(target), { kind: 'fillForm', fields: [{ selector: '#login', value: 'admin' }] })
    expect(result.ok).toBe(false)
    expect(result.filled?.[0]).toMatchObject({ selector: '#login', ok: false })
    expect(result.error).toContain('Не заполнено полей')
  })

  it('поле без значения объясняет, чего не хватает, и не роняет остальные', async () => {
    const result = await runSelectorAction(page(locator()), {
      kind: 'fillForm',
      fields: [{ selector: '#a' } as never, { selector: '#b', value: 'x' }]
    })
    expect(result.filled?.[0]).toMatchObject({ ok: false, error: 'Нужен value, values или checked' })
    expect(result.filled?.[1]).toMatchObject({ ok: true })
  })

  it('form-state возвращает поля страницы, а отсутствие формы — отказом', async () => {
    const form = { selector: 'form', total: 2, fields: [{ selector: '#login', tag: 'input' }] }
    expect(await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => form) }), { kind: 'formState' }))
      .toMatchObject({ ok: true, form: { total: 2 } })
    expect(await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => null) }), { kind: 'formState' }))
      .toEqual({ ok: false, error: 'Форма не найдена' })
  })

  it('validity отдаёт блокирующие поля с причинами браузера', async () => {
    const validity = { valid: false, checked: 3, blocking: [{ selector: '#email', message: 'Введите адрес', reasons: ['typeMismatch'] }] }
    const result = await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => validity) }), { kind: 'validity' })
    expect(result).toMatchObject({ ok: true, validity: { valid: false, blocking: [{ reasons: ['typeMismatch'] }] } })
  })

  it('submit отказывает словами, когда браузер не пропустил проверку', async () => {
    let call = 0
    const target = locator({ evaluate: vi.fn(async () => (call++ === 0 ? true : { ok: false, error: 'Форма не прошла проверку браузера' })) })
    expect(await runSelectorAction(page(target), { kind: 'submit' })).toEqual({ ok: false, error: 'Форма не прошла проверку браузера' })
  })

  it('options объясняет отказ на элементе без вариантов выбора', async () => {
    const result = await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => null) }), { kind: 'options', selector: '#name' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('нет вариантов выбора')
  })

  it('set с несколькими значениями уходит одним selectOption: по одному они затирают друг друга', async () => {
    const target = locator()
    await runSelectorAction(page(target), { kind: 'set', selector: '#tags', values: ['a', 'b'] })
    expect(target.selectOption).toHaveBeenCalledWith(['a', 'b'], expect.anything())
  })

  it('upload проверяет общий размер файлов, а не каждый по отдельности', async () => {
    const big = 'A'.repeat(Math.ceil((8 * 1024 * 1024) / 3) * 4 - 4)
    const result = await runSelectorAction(page(locator()), {
      kind: 'upload', selector: '#file', name: 'a.bin', base64: big,
      files: [{ name: 'a.bin', base64: big }, { name: 'b.bin', base64: big }]
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('вместе больше')
  })

  it('drop-file отвергает испорченный base64 до обращения к странице', async () => {
    const target = locator()
    const result = await runSelectorAction(page(target), { kind: 'dropFile', selector: '#zone', files: [{ name: 'a.txt', base64: 'не base64!' }] })
    expect(result).toEqual({ ok: false, error: 'Некорректное содержимое base64' })
    expect(target.evaluate).toBeDefined()
  })
})

// Круг 3: добраться до содержимого. Раньше модель имела плоское чтение и слепую
// прокрутку — на ленивой ленте это либо первый экран, либо бесконечный цикл.
describe('содержимое и прокрутка', () => {
  it('count отдаёт и видимые, и все совпадения, а по умолчанию считает видимые', async () => {
    const target = locator({ count: async () => 7, filter: () => locator({ count: async () => 3 }) })
    const result = await runSelectorAction(page(target), { kind: 'count', selector: '.row' })
    expect(result).toMatchObject({ ok: true, total: 3, counted: { visible: 3, all: 7 } })
  })

  it('count по запросу считает и скрытые', async () => {
    const target = locator({ count: async () => 7, filter: () => locator({ count: async () => 3 }) })
    const result = await runSelectorAction(page(target), { kind: 'count', selector: '.row', visibleOnly: false })
    expect(result.total).toBe(7)
  })

  it('scroll-until останавливается, как только цель стала видимой', async () => {
    const visible = locator({ count: async () => 1 })
    const target = locator({ filter: () => visible })
    const scrolled = vi.fn(async () => ({ moved: 800, top: 800, atBottom: false }))
    const result = await runSelectorAction(page(target, { evaluate: scrolled }), { kind: 'scrollUntil', text: 'Итого' })
    expect(result).toMatchObject({ ok: true, scrolledUntil: { found: true, scrolls: 0 } })
    expect(scrolled).not.toHaveBeenCalled()
  })

  it('scroll-until честно говорит, что лента кончилась, а цель не появилась', async () => {
    const hidden = locator({ count: async () => 0 })
    const target = locator({ filter: () => hidden })
    const result = await runSelectorAction(
      page(target, { evaluate: vi.fn(async () => ({ moved: 0, top: 1200, atBottom: true })) }),
      { kind: 'scrollUntil', selector: '#last', maxScrolls: 5 }
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('конца ленты')
    expect(result.scrolledUntil).toMatchObject({ found: false, atBottom: true })
  })

  it('scroll-until не крутит бесконечно и сообщает число прокруток', async () => {
    const hidden = locator({ count: async () => 0 })
    const target = locator({ filter: () => hidden })
    const scrolled = vi.fn(async () => ({ moved: 800, top: 800, atBottom: false }))
    const result = await runSelectorAction(page(target, { evaluate: scrolled }), { kind: 'scrollUntil', selector: '#x', maxScrolls: 2 })
    expect(result.ok).toBe(false)
    expect(scrolled).toHaveBeenCalledTimes(3)
    expect(result.scrolledUntil?.scrolls).toBe(3)
  })

  it('table возвращает строки записями, а пустую таблицу — отказом', async () => {
    const table = { selector: 'table', headings: ['Имя'], total: 3, offset: 0, rows: [{ Имя: 'Алиса' }], nextOffset: 1 }
    expect(await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => table) }), { kind: 'table', selector: 'table' }))
      .toMatchObject({ ok: true, table: { nextOffset: 1 } })
    expect((await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => null) }), { kind: 'table', selector: 'table' })).ok).toBe(false)
  })

  it('list отдаёт блоки со своими кнопками', async () => {
    const list = { selector: '.card', total: 2, offset: 0, items: [{ selector: '.card:nth-child(1)', text: 'Карточка', actions: [{ selector: 'button', text: 'Открыть' }] }] }
    const result = await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => list) }), { kind: 'list', selector: '.card' })
    expect(result.list?.items[0].actions?.[0].text).toBe('Открыть')
  })

  it('metrics и measure отдают геометрию, а отсутствующий элемент — отказ', async () => {
    const metrics = { scroll: { top: 0, left: 0 }, page: { width: 1280, height: 4000 }, viewport: { width: 1280, height: 800 }, screensBelow: 4, atBottom: false }
    expect(await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => metrics) }), { kind: 'metrics' })).toMatchObject({ ok: true, metrics: { screensBelow: 4 } })
    expect(await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => null) }), { kind: 'measure', selector: '#gone' })).toEqual({ ok: false, error: 'Элемент не найден' })
  })

  it('highlight отказывается словами, когда подсвечивать нечего', async () => {
    expect(await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => null) }), { kind: 'highlight', selector: '#gone' }))
      .toEqual({ ok: false, error: 'Элемент не найден' })
  })
})
