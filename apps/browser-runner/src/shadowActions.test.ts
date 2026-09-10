import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { readElementTargets } from './elementTargets.js'
import { readPage } from './pageReading.js'
import { runSelectorAction } from './selectorActions.js'
import { READER_SHADOW_HTML } from './test/readerShadow.js'

let browser: Browser, page: Page
beforeAll(async () => { browser = await chromium.launch() })
beforeEach(async () => { page = await browser.newPage(); await page.setContent(READER_SHADOW_HTML) })
afterEach(async () => { await page?.close() })
afterAll(async () => { await browser?.close() })
async function describeAt(selector: string) {
  await page.locator(selector).scrollIntoViewIfNeeded()
  const box = await page.locator(selector).boundingBox()
  return runSelectorAction(page, { kind: 'describe', x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 })
}
const result = () => page.locator('#result').innerText()

it('read перечисляет структуру открытых и вложенных shadow roots', async () => {
  const read = await runSelectorAction(page, { kind: 'read' })
  expect(read.ok).toBe(true)
  expect(read.headings).toContainEqual({ level: 2, text: 'Теневая форма' })
  expect(read.buttons).toEqual(expect.arrayContaining(['Теневое действие', 'Вложенная кнопка']))
  expect(read.links).toContainEqual(expect.objectContaining({ text: 'Ссылка компонента' }))
  expect(read.tables).toContainEqual(expect.objectContaining({ caption: 'Данные компонента', rows: [['Ячейка']] }))
  const input = read.inputs!.find(item => item.value === 'Текущее значение')!
  expect(input).toBeDefined()
  expect(await runSelectorAction(page, { kind: 'type', selector: input.selector, text: 'Изменено моделью' })).toMatchObject({ ok: true })
  expect(await page.locator('#host >> #entry').inputValue()).toBe('Изменено моделью')
})

it('текст composed tree включает слоты один раз и исключает скрытые исходники', async () => {
  const read = await runSelectorAction(page, { kind: 'read' })
  expect(read.text).toContain('Теневая форма')
  expect(read.text).toContain('Вложенная кнопка')
  expect(read.text!.split('Действие из слота')).toHaveLength(2)
  expect(read.text).not.toContain('Скрытый текст компонента')
  expect(read.text).not.toContain('function report')
})

it('find различает одинаковый id в light DOM и Shadow DOM последующим кликом', async () => {
  for (const [text, expected] of [['Теневое действие', 'shadow'], ['Действие из слота', 'slot']]) {
    const found = await runSelectorAction(page, { kind: 'find', text })
    expect(found.matches).toHaveLength(1)
    expect(await page.locator(found.matches![0].selector).count()).toBe(1)
    expect(await runSelectorAction(page, { kind: 'click', selector: found.matches![0].selector })).toMatchObject({ ok: true })
    expect(await result()).toBe(expected)
    expect(JSON.stringify(found)).not.toContain('__targetPath')
  }
})

it('describe находит кнопку внутри двух shadow roots, и действие воспроизводится', async () => {
  const described = await describeAt('#host >> #nested >> #nested-button')
  expect(described.element).toMatchObject({ tag: 'button', text: 'Вложенная кнопка', matches: 1 })
  expect(await runSelectorAction(page, { kind: 'click', selector: described.element!.selector })).toMatchObject({ ok: true })
  expect(await result()).toBe('nested')
})

it('запись второй одинаковой кнопки не воспроизводит первую', async () => {
  const described = await describeAt('.repeat:nth-of-type(2)')
  expect(described.element?.matches).toBe(1)
  expect(await page.locator(described.element!.selector).count()).toBe(1)
  expect(await runSelectorAction(page, { kind: 'click', selector: described.element!.selector })).toMatchObject({ ok: true })
  expect(await result()).toBe('second')
})

it('глубокая вложенность текста не теряет интерактивного предка', async () => {
  const described = await describeAt('[data-inner="deep"]')
  expect(described.element).toMatchObject({ selector: '#deep', tag: 'button' })
  expect(await runSelectorAction(page, { kind: 'click', selector: described.element!.selector })).toMatchObject({ ok: true })
  expect(await result()).toBe('deep')
})

it('scrollTo понимает селектор Playwright внутри Shadow DOM и дерево ролей', async () => {
  const found = await runSelectorAction(page, { kind: 'find', text: 'Дальняя кнопка' })
  expect(await runSelectorAction(page, { kind: 'scrollTo', selector: found.matches![0].selector })).toMatchObject({ ok: true })
  const box = await page.locator(found.matches![0].selector).boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  expect(await runSelectorAction(page, { kind: 'scrollTo', selector: 'role=button[name="Вложенная кнопка"]' })).toMatchObject({ ok: true })
})

it('selector и text совместно ограничивают click, hover и find', async () => {
  expect(await runSelectorAction(page, { kind: 'click', selector: '.repeat', text: 'Вторая' })).toMatchObject({ ok: true })
  expect(await result()).toBe('second')
  await page.mouse.move(0, 0)
  expect(await runSelectorAction(page, { kind: 'hover', selector: '.repeat', text: 'Вторая' })).toMatchObject({ ok: true })
  expect(await result()).toBe('hover-second')
  expect(await runSelectorAction(page, { kind: 'find', selector: '.repeat', text: 'Вторая' })).toMatchObject({ total: 1, matches: [{ text: 'Вторая', selector: expect.any(String), visible: true }] })
})

it('aria-labelledby разрешается в root поля, а не в родительском документе', async () => {
  const read = await runSelectorAction(page, { kind: 'read', selector: '#host >> #entry' })
  expect(read.inputs?.[0].label).toBe('Внутренняя подпись')
})

it('disabled учитывает fieldset и исключение для его первого legend', async () => {
  const read = await runSelectorAction(page, { kind: 'read' })
  expect(read.inputs).toContainEqual(expect.objectContaining({ selector: '#disabled-field', disabled: true }))
  expect(read.inputs).toContainEqual(expect.objectContaining({ selector: '#legend-input', disabled: false }))
})


it('вставка соседа между чтением и уточнением не ломает уникальный id', async () => {
  const read = await readElementTargets(page, async () => {
    const content = await page.locator('#disabled-field').evaluate(readPage, { limit: 4000, offset: 0 })
    await page.evaluate('document.body.prepend(document.createElement("div"))')
    return content
  })
  expect(read.inputs).toContainEqual(expect.objectContaining({ selector: '#disabled-field', disabled: true }))
})

it('замена DOM между чтением и уточнением вызывает одно повторное чтение', async () => {
  let reads = 0
  const read = await readElementTargets(page, async () => {
    const content = await page.locator('body').evaluate(readPage, { limit: 4000, offset: 0 })
    if (++reads === 1) await page.evaluate('document.getElementById("disabled-field").remove()')
    return content
  })
  expect(reads).toBe(2)
  expect(read.inputs?.some(input => input.selector === '#disabled-field')).toBe(false)
  expect(read.headings).toContainEqual({ level: 2, text: 'Теневая форма' })
})
