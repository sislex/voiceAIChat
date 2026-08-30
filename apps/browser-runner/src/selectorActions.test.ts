// Селекторные действия модели: до этого раннер понимал только координаты, и
// MCP-инструменты (они селекторные) до изолированного Chromium не доставали.
// Логика вынесена из sessionManager отдельно, чтобы проверяться без Chromium.

import { describe, it, expect, vi } from 'vitest'
import { runSelectorAction, type SelectorLocator, type SelectorPage } from './selectorActions'

function locator(over: Partial<SelectorLocator> = {}): SelectorLocator {
  const self: SelectorLocator = {
    first: () => self,
    all: async () => [self],
    click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    innerText: async () => 'Текст узла',
    isVisible: async () => true,
    waitFor: vi.fn(async () => {}),
    hover: vi.fn(async () => {}),
    selectOption: vi.fn(async () => []),
    check: vi.fn(async () => {}),
    uncheck: vi.fn(async () => {}),
    dragTo: vi.fn(async () => {}),
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

  it('чтение обрезает длинный текст по лимиту, чтобы не раздувать контекст модели', async () => {
    const long = 'я'.repeat(5000)
    const result = await runSelectorAction(page(locator({ innerText: async () => long })), { kind: 'read', limit: 100 })
    expect(result.ok).toBe(true)
    expect(result.text).toHaveLength(101)
    expect(result.text?.endsWith('…')).toBe(true)
    // Признак обрезки — не украшение: по нему проверка сценария отличает
    // «текста нет» от «до текста не дочитали».
    expect(result.truncated).toBe(true)
    const whole = await runSelectorAction(page(locator({ innerText: async () => 'коротко' })), { kind: 'read' })
    expect(whole.truncated).toBeUndefined()
  })

  it('поиск возвращает совпадения с текстом и видимостью', async () => {
    const target = locator({ innerText: async () => '  Кнопка  ' })
    const result = await runSelectorAction(page(target), { kind: 'find', selector: 'button', limit: 5 })
    expect(result.ok).toBe(true)
    expect(result.matches?.[0]).toMatchObject({ text: 'Кнопка', visible: true })
  })

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

  it('без типа подставляется нейтральный, пустое содержимое отклоняется', async () => {
    const target = locator()
    await runSelectorAction(page(target), { kind: 'upload', selector: '#f', name: 'a.bin', base64: 'AA==' })
    expect(target.setInputFiles).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'application/octet-stream' }), expect.anything())
    expect(await runSelectorAction(page(locator()), { kind: 'upload', selector: '#f', name: 'a', base64: '' })).toEqual({ ok: false, error: 'Пустое содержимое файла' })
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
    expect(await runSelectorAction(page(locator(), { evaluate: vi.fn(async () => false) }), { kind: 'scrollTo', selector: '#нет' }))
      .toEqual({ ok: false, error: 'Элемент #нет не найден' })
  })
})
