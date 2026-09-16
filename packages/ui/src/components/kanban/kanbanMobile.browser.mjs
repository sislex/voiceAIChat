// Run against Storybook: node packages/ui/src/components/kanban/kanbanMobile.browser.mjs
import { chromium, expect } from 'playwright/test'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
const page = await context.newPage()
page.on('pageerror', (error) => console.error(error.message))
page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
const base = process.env.STORYBOOK_URL ?? 'http://127.0.0.1:6018'
const open = async (story) => {
  await page.goto(`${base}/iframe.html?id=kanban-kanbanboard--${story}&viewMode=story`)
  await expect(page.getByTestId('kanban-board')).toBeVisible({ timeout: 60000 })
}
try {
  // @testCase TC1
  await open('mobile-scroll')
  const board = page.getByTestId('kanban-board')
  await expect(page.getByTestId('kanban-column')).toHaveCount(1)
  await expect(page.getByRole('combobox', { name: 'Активная колонка' }).locator('option')).toHaveCount(6)
  await expect(page.getByTestId('board-summary')).toBeHidden()
  await expect(page.getByTestId('priority-overview')).toBeHidden()
  await expect(board).toHaveCSS('overflow-x', 'hidden')
  await page.getByRole('button', { name: 'Следующая колонка' }).click()
  await expect(page.getByText('Колонка 2 из 6')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Колонка 2 из 6')).toBeVisible()
  await page.getByRole('button', { name: 'Предыдущая колонка' }).click()
  const first = page.getByTestId('kanban-column').first()
  const head = first.locator('.jcol-head')
  const before = await head.boundingBox()
  await first.locator('.jcol-content').evaluate((element) => { element.scrollTop = 300 })
  expect((await head.boundingBox()).y).toBe(before.y)
  expect(await first.locator('.jcol-content').evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await expect(page.getByTestId('board-mobile-create')).toHaveCount(1)
  await expect(page.getByTestId('column-create')).toHaveCount(0)
  await page.getByTestId('board-mobile-create').click()
  await expect(page.getByRole('dialog', { name: 'Создать задачу: Колонка 1' })).toBeVisible()
  await page.keyboard.press('Escape')

  // @testCase TC2
  const card = first.getByTestId('task-card').first()
  await first.locator('.jcol-content').evaluate((element) => { element.scrollTop = 0 })
  await expect(card.locator('.jcard-chips')).toBeHidden()
  await expect(card.locator('.jcard-title')).toBeVisible()
  await expect(card.locator('.jcard-assignee')).toBeVisible()
  await card.getByRole('button', { name: /Действия с/ }).click()
  await page.getByRole('menuitem', { name: 'Все данные карточки' }).click()
  await expect(page.getByRole('dialog')).toContainText('mobile, design, accessibility')
  await page.keyboard.press('Escape')
  const filters = page.getByRole('button', { name: /^Фильтры / })
  await filters.click()
  await page.getByRole('searchbox', { name: 'Поиск на доске', exact: true }).fill('no matching task')
  await page.getByRole('dialog').getByRole('button', { name: 'Сбросить все', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(filters).toBeFocused()
  await expect(page.getByText('Под фильтр ничего не попало — сбросить').first()).toBeVisible()
  await filters.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Сбросить все', exact: true }).click()
  await expect(filters).toHaveText('Фильтры (0 активных)')
  await page.getByRole('button', { name: 'Компактная плотность' }).click()
  await page.keyboard.press('Escape')

  // @testCase TC4
  await page.reload()
  await expect(board).toHaveClass(/jboard--density-compact/)
  await first.locator('.jcol-content').evaluate((element) => { element.scrollTop = 0 })

  // @testCase TC3
  await card.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('kanban-live')).toContainText('колонка Development, позиция')
  await expect(board).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('kanban-live')).toContainText('позиция 2 из 4')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('kanban-live')).toContainText('отменён')
  // @testCase TC-UI-02
  await page.getByRole('combobox', { name: 'Активная колонка' }).selectOption({ index: 0 })
  await board.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('Колонка 2 из 6')).toBeVisible()
  await page.keyboard.press('Home')
  await expect(page.getByText('Колонка 1 из 6')).toBeVisible()

  // @testCase TC5
  await page.setViewportSize({ width: 720, height: 844 })
  await expect(page.getByTestId('kanban-column')).toHaveCount(1)
  await page.setViewportSize({ width: 800, height: 844 })
  await expect(page.getByTestId('board-mobile-create')).toHaveCount(0)
  await expect(page.getByTestId('column-create')).toHaveCount(6)
  await page.setViewportSize({ width: 390, height: 844 })
  if (process.env.KANBAN_SCREENSHOT) await page.screenshot({ path: process.env.KANBAN_SCREENSHOT })
  await open('mobile-filters')
  await expect(page.getByRole('dialog', { name: 'Фильтры и меню доски' })).toBeVisible()
  // @testCase TC-REG-01
  // @testCase TC-UI-01
  // @testCase TC-UI-03
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of [[1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 700]]) {
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
      await page.setViewportSize({ width, height })
      await open('mobile-scroll')
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme
        document.querySelectorAll('[data-theme]').forEach(element => { element.dataset.theme = theme })
      }, theme)
      const narrow = width <= 720
      await expect(page.getByTestId('kanban-column')).toHaveCount(narrow ? 1 : 6)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (narrow) {
        const selection = page.getByRole('combobox', { name: 'Активная колонка' })
        for (let index = 0; index < 6; index++) {
          await selection.selectOption({ index })
          await expect(page.getByText(`Колонка ${index + 1} из 6`)).toBeVisible()
          await expect(page.getByTestId('kanban-column')).toHaveCount(1)
        }
        await selection.selectOption({ index: 0 })
        const content = page.locator('.jcol-content').first()
        await content.evaluate(element => { element.scrollTop = element.scrollHeight })
        const lastCard = await content.getByTestId('task-card').last().boundingBox()
        const create = page.getByTestId('board-mobile-create')
        const fab = await create.boundingBox()
        expect(lastCard.y + lastCard.height).toBeLessThanOrEqual(fab.y)
        await content.getByTestId('task-card').last().getByRole('button', { name: /Действия с/ }).click()
        const menu = page.getByRole('menu', { name: /Действия с/ })
        const menuBox = await menu.boundingBox()
        expect(menuBox.x).toBeGreaterThanOrEqual(0)
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width)
        expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(height)
        await menu.getByRole('menuitem', { name: 'Удалить', exact: true }).scrollIntoViewIfNeeded()
        await expect(menu.getByRole('menuitem', { name: 'Удалить', exact: true })).toBeInViewport()
        await expect(create).toBeHidden()
        await page.keyboard.press('Escape')
        await create.click()
        await expect(page.getByRole('dialog', { name: /Создать задачу/ })).toBeVisible()
        await expect(create).toBeHidden()
        await page.keyboard.press('Escape')
        await expect(create).toBeFocused()
      }
      await page.screenshot({ path: `.mobile-shots/CHAT-472-${theme}-${width}x${height}.png` })
      if (narrow) await page.getByRole('button', { name: /^Фильтры / }).click()
      await page.getByRole('button', { name: 'Компактная плотность' }).click()
      await page.getByRole('searchbox', { name: 'Поиск на доске', exact: true }).fill('no matching result')
      if (narrow) {
        await page.getByRole('button', { name: 'Компактная плотность' }).focus()
        await page.keyboard.press('Escape')
      }
      await expect(page.getByTestId('task-card')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (narrow) await page.getByRole('button', { name: /^Фильтры / }).click()
      await page.getByRole('searchbox', { name: 'Поиск на доске', exact: true }).fill('')
      await page.getByRole('combobox', { name: 'Свимлейны' }).selectOption('assignee')
      if (narrow) await page.keyboard.press('Escape')
      await expect(page.getByTestId('kanban-column')).toHaveCount(narrow ? 1 : 6)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      for (const story of ['empty-board', 'loading', 'error-state', 'refreshing', 'error-with-board', 'wip-exceeded']) {
        await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
        await page.goto(`${base}/iframe.html?id=kanban-kanbanboard--${story}&viewMode=story`)
        if (story === 'loading') await expect(page.getByTestId('kanban-skeleton')).toBeVisible({ timeout: 60000 })
        else if (story === 'error-state') await expect(page.getByRole('button', { name: /Повторить/ }).first()).toBeVisible({ timeout: 60000 })
        else await expect(page.getByTestId('kanban-board')).toBeVisible({ timeout: 60000 })
        await page.evaluate(theme => {
          document.documentElement.dataset.theme = theme
          document.querySelectorAll('[data-theme]').forEach(element => { element.dataset.theme = theme })
        }, theme)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        if (narrow && !['loading', 'error-state', 'empty-board'].includes(story)) {
          await expect(page.getByTestId('kanban-column')).toHaveCount(1)
        }
        await page.screenshot({ path: `.mobile-shots/CHAT-472-${theme}-${width}x${height}-${story}.png` })
      }
    }
  }
  // @testCase TC-REG-01
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.setViewportSize({ width: 1280, height: 720 })
  await open('mobile-scroll')
  await page.locator('.jboard-wrap').evaluate(element => { element.style.width = '500px' })
  await expect(page.getByTestId('kanban-column')).toHaveCount(1)
  await expect(page.getByTestId('board-mobile-create')).toBeVisible()
  await page.locator('.jboard-wrap').evaluate(element => { element.style.removeProperty('width') })
  await expect(page.getByTestId('kanban-column')).toHaveCount(6)
  console.log('CHAT-472: both themes and all five viewports passed; OS keyboard/safe-area/screen reader require device evidence')
} catch (error) {
  console.error(page.url(), await page.locator('body').innerText())
  throw error
} finally {
  await browser.close()
}
