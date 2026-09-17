// @testCase T7
// Run against an isolated Storybook instance on port 6045.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const base = process.env.CHAT_STORYBOOK_URL ?? 'http://127.0.0.1:6045'
  await page.goto(base + '/iframe.html?id=chat-chatcolumn--mobile-composer-390&viewMode=story')
  await page.getByRole('button', { name: 'Поиск', exact: true }).waitFor()
  assert.equal(await page.locator('main').evaluate((el) => el.classList.contains('main--compact')), true)
  await page.getByRole('button', { name: 'Поиск', exact: true }).click()
  await page.getByLabel('Найти в беседе').fill('код')
  const geometry = await page.evaluate(() => {
    return { search: document.querySelector('.chat-search')!.getBoundingClientRect().toJSON(), composer: document.querySelector('.chat-composer')!.getBoundingClientRect().toJSON(), scroll: document.querySelector('.scroll')!.getBoundingClientRect().toJSON(), width: innerWidth }
  })
  await page.screenshot({ path: '/tmp/chat450-390.png', fullPage: true })
  assert.ok(geometry.search.right <= geometry.width + 1)
  assert.ok(geometry.composer.top >= geometry.scroll.bottom - 1)
  assert.ok(geometry.composer.width <= 390)
  await page.screenshot({ path: '/tmp/chat450-390.png', fullPage: true })
  await page.getByLabel('Закрыть поиск').click()
  await page.locator('main .scroll').focus()
  await page.keyboard.press('Control+f')
  await page.getByLabel('Найти в беседе').waitFor()
  await page.goto(base + '/iframe.html?id=chat-chatcolumn--new-messages&viewMode=story')
  await page.getByText('↓ Новые сообщения (1)').waitFor()
  await page.getByRole('button', { name: 'К новому сообщению' }).click()
  await page.getByText('↓ Новые сообщения (1)').waitFor({ state: 'hidden' })
  console.log('PASS: 390px composer/search geometry, scoped find shortcut and unread story')
} finally { await browser.close() }
