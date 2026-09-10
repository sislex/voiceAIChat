import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { runSelectorAction } from './selectorActions.js'
import { startReaderFormsFixture } from './test/readerForms.js'

let browser: Browser, page: Page
let site: Awaited<ReturnType<typeof startReaderFormsFixture>>
beforeAll(async () => { site = await startReaderFormsFixture(); browser = await chromium.launch() })
beforeEach(async () => { page = await browser.newPage(); await page.goto(`${site.origin}/reading`) })
afterEach(async () => { await page?.close() })
afterAll(async () => { await browser?.close(); await site?.close() })
async function describe(selector: string) {
  const box = await page.locator(selector).boundingBox()
  return runSelectorAction(page, { kind: 'describe', x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 })
}

it('read возвращает структуру страницы и пригодные для действий поля', async () => {
  const result = await runSelectorAction(page, { kind: 'read' })
  expect(result.ok).toBe(true)
  expect(result.headings).toContainEqual({ level: 1, text: 'Почта' })
  expect(result.links).toContainEqual({ text: 'Открыть письмо', href: `${site.origin}/next` })
  expect(result.buttons).toContain('Next >> literal')
  expect(result.inputs).toContainEqual(expect.objectContaining({ selector: '#subject', value: 'Тема письма', label: 'Тема' }))
  expect(result.inputs?.find(input => input.type === 'password')?.value).toBe('')
  expect(JSON.stringify(result)).not.toContain('fixture-password')
})

it('длинный текст можно прочитать без пропусков через offset и nextOffset', async () => {
  const first = await runSelectorAction(page, { kind: 'read', selector: '#long', limit: 100 })
  expect(first).toMatchObject({ total: 6000, offset: 0, nextOffset: 100, truncated: true })
  const last = await runSelectorAction(page, { kind: 'read', selector: '#long', limit: 100, offset: 5950 })
  expect(last).toMatchObject({ text: '0123456789'.repeat(5), total: 6000, offset: 5950 })
  expect(last.nextOffset).toBeUndefined()
  expect(last.truncated).toBeUndefined()
})

it('чтение поля показывает текущее значение, а select — выбранную подпись', async () => {
  await page.locator('#subject').fill('Изменено')
  await page.locator('#message').fill('Новый текст')
  await page.locator('#language').selectOption('en')
  for (const [selector, text] of [['#subject', 'Изменено'], ['#message', 'Новый текст'], ['#language', 'English'], ['#secret', '']]) {
    expect(await runSelectorAction(page, { kind: 'read', selector })).toMatchObject({ ok: true, text })
  }
})

it('описание парольного поля не раскрывает его значение', async () => {
  const result = await describe('#secret')
  expect(result.ok).toBe(true)
  expect(result.element?.text).toBe('')
  expect(JSON.stringify(result)).not.toContain('fixture-password')
})

it('testid и aria-label с кавычками и слешами дают рабочие селекторы', async () => {
  await page.evaluate('document.getElementById("labelled").removeAttribute("id")')
  for (const original of ['#quoted', 'button[aria-label]']) {
    const result = await describe(original)
    expect(result.element?.matches).toBe(1)
    expect(await page.locator(result.element!.selector).count()).toBe(1)
    expect(await page.locator(result.element!.selector).textContent()).toBe(await page.locator(original).textContent())
  }
})

it('найденный буквальный текст с >> можно использовать для следующего клика', async () => {
  const found = await runSelectorAction(page, { kind: 'find', text: 'Next >> literal' })
  expect(found.matches).toHaveLength(1)
  expect(await runSelectorAction(page, { kind: 'click', selector: found.matches![0].selector })).toMatchObject({ ok: true })
  expect(await page.locator('#click-result').innerText()).toBe('нажато')
})

it('поиск сообщает число совпадений до усечения', async () => {
  expect(await runSelectorAction(page, { kind: 'find', selector: '.choice', limit: 1, visibleOnly: false })).toMatchObject({ total: 3, truncated: true, matches: [expect.anything()] })
  expect((await runSelectorAction(page, { kind: 'find', selector: '.choice', limit: 5, visibleOnly: false })).truncated).toBeUndefined()
})

it('visibleOnly удаляет скрытые копии до применения лимита', async () => {
  const result = await runSelectorAction(page, { kind: 'find', selector: '.choice', limit: 1, visibleOnly: true })
  expect(result).toMatchObject({ total: 2, truncated: true, matches: [{ text: 'Видимо', visible: true }] })
  expect(await runSelectorAction(page, { kind: 'click', selector: result.matches![0].selector })).toMatchObject({ ok: true })
})

it('read описывает таблицу и ограничивает большие наборы строк и колонок', async () => {
  const result = await runSelectorAction(page, { kind: 'read', selector: '#messages' })
  expect(result.tables).toEqual([{ selector: '#messages', caption: 'Входящие письма', rows: [['Отправитель', 'Тема'], ['Команда', 'Привет']], totalRows: 2, totalColumns: 2 }])
  await page.evaluate('(() => {const table=document.getElementById("messages");for(let i=0;i<25;i++){const row=table.insertRow();for(let j=0;j<25;j++)row.insertCell().textContent="ячейка"}})()')
  const large = (await runSelectorAction(page, { kind: 'read', selector: '#messages' })).tables![0]
  expect(large).toMatchObject({ totalRows: 27, totalColumns: 25, truncated: true })
  expect(large.rows.length).toBeLessThanOrEqual(20)
  expect(Math.max(...large.rows.map(row => row.length))).toBeLessThanOrEqual(20)
})

it('read сообщает вложенные iframe и их адреса без притворного чтения содержимого', async () => {
  const result = await runSelectorAction(page, { kind: 'read' })
  expect(result.frames).toEqual([{ selector: '#preview', src: `${site.origin}/next`, title: 'Превью письма', name: 'preview' }])
  expect(result.text).not.toContain('Переход завершён')
})

it('длинные списки и таблицы не ломают ограничение сериализованного ответа MCP', async () => {
  await page.evaluate('(() => {const table=document.getElementById("messages");for(let i=0;i<30;i++){const row=table.insertRow();for(let j=0;j<30;j++)row.insertCell().textContent="я".repeat(300)}for(let i=0;i<100;i++){const a=document.createElement("a");a.href="/"+"x".repeat(1000);a.textContent="Ссылка "+i;document.body.appendChild(a)}})()')
  const result = await runSelectorAction(page, { kind: 'read', limit: 20_000 })
  expect(result.ok).toBe(true)
  expect(result.structureTruncated).toBe(true)
  expect(JSON.stringify(result).length).toBeLessThan(32_000)
  expect(result.nextOffset).toBe(20_000)
})

it('невалидные параметры чтения не становятся успешным пустым ответом', async () => {
  for (const args of [{ offset: -1 }, { offset: Infinity }, { limit: 0 }, { limit: 20_001 }]) {
    expect(await runSelectorAction(page, { kind: 'read', ...args })).toMatchObject({ ok: false, error: expect.any(String) })
  }
})

it('пустой видимый документ не заменяется исходниками script и style', async () => {
  await page.setContent('<body><script>window.readerInvisibleSource="служебный исходник"</script><style>body{color:red}</style></body>')
  const result = await runSelectorAction(page, { kind: 'read' })
  expect(result).toMatchObject({ ok: true, text: '', total: 0 })
})


it('find по умолчанию исключает скрытые копии до лимита', async () => {
  const result = await runSelectorAction(page, { kind: 'find', selector: '.choice', limit: 1 })
  expect(result).toMatchObject({ total: 2, truncated: true, matches: [{ text: 'Видимо', visible: true }] })
})

it('find сохраняет узел после вставки соседа и отвергает DOM-копию найденного узла', async () => {
  await page.setContent('<button>Первый</button><button>Второй</button>')
  const found = await runSelectorAction(page, { kind: 'find', selector: 'button' })
  const selector = found.matches![1].selector
  await page.evaluate('const next = document.createElement("button"); next.textContent = "Новый"; document.body.prepend(next)')
  expect(await page.locator(selector).textContent()).toBe('Второй')
  expect(await runSelectorAction(page, { kind: 'click', selector })).toMatchObject({ ok: true })
  await page.locator(selector).evaluate(node => node.replaceWith(node.cloneNode(true)))
  expect((await runSelectorAction(page, { kind: 'click', selector })).error).toContain('stale_element_ref')
})
