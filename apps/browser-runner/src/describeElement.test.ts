// Скрипт описания элемента исполняется в браузере, поэтому проверяем его так же
// — в настоящей странице Chromium, а не заглушками: заглушка проверила бы наши
// же представления о DOM.
//
// @vitest-environment node
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { describeElementScript, scrollToScript } from './describeElement.js'

const HTML = `<!doctype html><html><body style="margin:0">
  <button data-testid="create" style="position:absolute;left:10px;top:10px;width:100px;height:40px"><span>Создать</span></button>
  <button aria-label="Закрыть" style="position:absolute;left:200px;top:10px;width:40px;height:40px">✕</button>
  <button id="save" style="position:absolute;left:10px;top:60px;width:100px;height:40px">Сохранить</button>
  <button aria-label="Закрыть" style="position:absolute;left:10px;top:110px;width:100px;height:40px">✕</button>
  <div style="position:absolute;left:10px;top:160px"><span>раз</span><span>два</span></div>
  <div id="far" style="position:absolute;top:3000px">внизу</div>
</body></html>`

let browser: Browser
let page: Page
beforeAll(async () => {
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 400, height: 300 } })
  await page.setContent(HTML)
})
afterAll(async () => { await browser?.close() })

const at = (x: number, y: number) => page.evaluate(describeElementScript(x, y)) as Promise<{ selector: string; stability: string; tag: string; text: string; matches?: number; rect: { width: number; height: number } } | null>

describe('describeElementScript', () => {
  it('data-testid предпочитается всему — он и ставится ради тестов', async () => {
    expect(await at(50, 30)).toMatchObject({ selector: '[data-testid="create"]', stability: 'testid', tag: 'button', text: 'Создать' })
  })
  it('id — следующий по устойчивости', async () => {
    expect(await at(50, 80)).toMatchObject({ selector: '#save', stability: 'id' })
  })
  it('aria-label берётся, когда ни testid, ни id нет', async () => {
    expect(await at(50, 130)).toMatchObject({ selector: 'button[aria-label="Закрыть"]', stability: 'label' })
  })
  it('без опознавательных знаков строится путь и честно помечается ненадёжным', async () => {
    const found = await at(20, 170)
    expect(found?.stability).toBe('path')
    expect(found?.selector).toContain('span')
    // Второй одноимённый сосед обязан различаться позицией, иначе селектор
    // указывает не туда.
    const second = await at(45, 170)
    expect(second?.selector).not.toBe(found?.selector)
  })
  it('возвращает размер и положение — для разбора вёрстки и целей нажатия', async () => {
    expect((await at(50, 30))?.rect).toMatchObject({ width: 100, height: 40 })
  })
  it('клик мимо содержимого не даёт пустой селектор', async () => {
    // elementFromPoint возвращает html, путь по тегам при этом пуст — раньше
    // получался селектор '', то есть заведомо сломанный шаг сценария.
    const found = await page.evaluate(describeElementScript(399, 299)) as { selector: string; tag: string }
    expect(found.selector).not.toBe('')
    expect(found.selector).toBe(found.tag)
  })
})

describe('scrollToScript', () => {
  it('доводит до элемента за пределами вьюпорта', async () => {
    expect(await page.evaluate(scrollToScript('#far'))).toBe(true)
    expect(await page.evaluate('Math.round(window.scrollY) > 0')).toBe(true)
  })
  it('несуществующий селектор — false, а не исключение', async () => {
    expect(await page.evaluate(scrollToScript('#нет-такого'))).toBe(false)
  })
})

describe('устойчивость селектора (круг 14)', () => {
  // Предыдущий блок прокрутил страницу к #far — координаты кнопок без возврата
  // наверх указывали бы в пустоту.
  beforeAll(async () => { await page.evaluate('window.scrollTo(0, 0)') })

  it('клик по тексту внутри кнопки даёт селектор кнопки, а не вложенного span', async () => {
    // elementFromPoint отдаёт самый верхний узел; data-testid при этом стоит на
    // кнопке, и без подъёма получался бы путь от span.
    expect(await at(50, 30)).toMatchObject({ selector: '[data-testid="create"]', tag: 'button' })
  })

  it('сообщает, сколько узлов отвечает селектору', async () => {
    expect((await at(50, 30))?.matches).toBe(1)
    // В разметке уже две кнопки с aria-label="Закрыть"; добавляем третью.
    // Записанный шаг кликнет по первой, и знать об этом надо при записи, а не
    // когда сценарий однажды нажмёт не ту кнопку.
    expect((await at(220, 30))?.matches).toBe(2)
    // Код строкой, а не замыканием: у пакета нет библиотеки DOM (это
    // Node-сервис), и `document` в замыкании не проходит typecheck. Замыкание
    // здесь молча ломало гейт пять кругов подряд.
    await page.evaluate('(() => { const extra = document.createElement("button"); extra.setAttribute("aria-label", "Закрыть"); document.body.appendChild(extra) })()')
    expect((await at(220, 30))?.matches).toBe(3)
  })
})
