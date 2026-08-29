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
    ...over
  }
  return self
}

function page(target: SelectorLocator, over: Partial<SelectorPage> = {}): SelectorPage {
  return {
    locator: vi.fn(() => target),
    getByText: vi.fn(() => target),
    keyboard: { press: vi.fn(async () => {}) },
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
