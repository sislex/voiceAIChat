// Скриншоты интерфейса в телефонном вьюпорте (390×844) через Playwright.
//
// Зачем отдельный скрипт: окно браузера в автоматизации не всегда поддаётся
// ресайзу (полноэкранный режим macOS), а мобильную раскладку проверять надо
// каждый раз. Headless-прогон от окна не зависит и заодно считает две вещи,
// которые глазами ловятся плохо: горизонтальный вылет и слишком мелкие цели
// нажатия.
//
// Запуск (dev-стек уже поднят):
//   VC_SHOTS_BASE=http://127.0.0.1:5299 VC_SHOTS_USER=… VC_SHOTS_PASSWORD=… \
//   VC_SHOTS_PROJECT=<id> VC_SHOTS_INVITE=<token> npx tsx scripts/mobile-shots.mts
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.VC_SHOTS_BASE ?? 'http://127.0.0.1:5299'
const OUT = process.env.VC_SHOTS_OUT ?? '.mobile-shots'
const USER = process.env.VC_SHOTS_USER ?? ''
const PASSWORD = process.env.VC_SHOTS_PASSWORD ?? ''
const PROJECT = process.env.VC_SHOTS_PROJECT ?? ''
const INVITE = process.env.VC_SHOTS_INVITE ?? ''
/** Тема: светлая по умолчанию; тёмную надо смотреть отдельно — контраст другой. */
const THEME = process.env.VC_SHOTS_THEME ?? ''

/** iPhone 14 — самый узкий из актуальных; проходит он, пройдут и шире. */
const VIEWPORT = { width: 390, height: 844 }
/**
 * Ниже этого пальцем попадать неудобно. Рекомендация Apple и Google — 44px;
 * берём 40 как компромисс с плотностью списков. Порог сделан падающим
 * (`process.exitCode = 1`), поэтому регресс раскладки виден сразу, а не «когда
 * кто-нибудь посмотрит скриншоты».
 */
const MIN_TAP_HEIGHT = Number(process.env.VC_SHOTS_MIN_TAP ?? 40)

interface Problem { screen: string; kind: 'overflow' | 'tap'; detail: string }
const problems: Problem[] = []

async function shot(page: Page, name: string): Promise<void> {
  if (THEME) {
    // Тему приложение ставит и на <html> (окна уходят порталом в body).
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
      document.querySelector('.app')?.setAttribute('data-theme', theme)
    }, THEME)
    await page.waitForTimeout(200)
  }
  await page.screenshot({ path: `${OUT}/${name}.png` })
  const overflow = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }))
  if (overflow.scrollW > overflow.clientW + 1) {
    problems.push({ screen: name, kind: 'overflow', detail: `${overflow.scrollW} > ${overflow.clientW}` })
  }
  const small = await page.evaluate((min) => [...document.querySelectorAll('button, a, select, input')]
    .filter((el) => (el as HTMLElement).offsetParent !== null)
    .map((el) => {
      // Считаем ЭФФЕКТИВНУЮ цель: чекбокс 20px внутри 40px-подписи нажимается по
      // всей подписи, и ругаться на него — ложная тревога. Берём ближайшего
      // предка-обёртку, если он кликабелен вместе с элементом.
      const wrapper = el.closest('label, button') as HTMLElement | null
      const box = (wrapper ?? el).getBoundingClientRect()
      return {
        label: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40),
        // Класс обёртки — чтобы чинить точечно, а не подбирать селектор вслепую.
        cls: ((wrapper ?? el).className || el.className || '').toString().slice(0, 60),
        h: Math.round(Math.max(box.height, el.getBoundingClientRect().height))
      }
    })
    .filter((t) => t.h > 0 && t.h < min), MIN_TAP_HEIGHT)
  if (small.length) problems.push({ screen: name, kind: 'tap', detail: JSON.stringify(small) })
  console.log(`✓ ${name}`)
}

/**
 * Выдвинуть боковую панель, если она за экраном (телефонная раскладка).
 * Судим по координатам, а не по isVisible: у выехавшей панели элементы
 * «видимы» для Playwright (ненулевой размер), но лежат при x < 0 и не кликаются.
 */
async function openSidebar(page: Page): Promise<void> {
  const onScreen = await page.evaluate(() => {
    const create = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Новый проект'))
    return create ? create.getBoundingClientRect().left >= 0 : false
  })
  if (onScreen) return
  const toggle = page.locator('.sidebar-toggle[aria-expanded="false"]')
  if (await toggle.count()) {
    await toggle.first().click()
    await page.waitForTimeout(600)
    return
  }
  // Панель может быть свёрнута и без переключателя в шапке (экраны без ToolFrame).
  const hamburger = page.locator('button[aria-label="Открыть боковую панель"]')
  if (await hamburger.count()) {
    await hamburger.first().click()
    await page.waitForTimeout(600)
  }
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
try {
  if (INVITE) {
    // Экран приглашения до входа — в отдельном контексте, без сессии.
    const anon = await browser.newContext({ viewport: VIEWPORT })
    const page = await anon.newPage()
    await page.goto(`${BASE}/#/project-invite/${INVITE}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="invite-screen"]')
    await page.waitForTimeout(500)
    await shot(page, '1-invite-anon')
    await anon.close()
  }

  if (USER) {
    const ctx = await browser.newContext({ viewport: VIEWPORT })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.locator('.login-card input').first().fill(USER)
    await page.locator('.login-card input[type="password"]').fill(PASSWORD)
    // Именно «Войти»: в карточке есть ещё глазок пароля и ссылки.
    await page.locator('.login-card button', { hasText: 'Войти' }).first().click()
    await page.waitForTimeout(2500)
    const welcome = page.locator('button', { hasText: 'Пропустить и начать' })
    if (await welcome.count()) await welcome.first().click()

    await page.goto(`${BASE}/#/projects`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await shot(page, '2-projects-list')

    // На телефоне сайдбар — выдвижной, и список проектов вместе с кнопкой
    // создания живёт в нём. Без этого шага мобильный прогон просто не находит их.
    await openSidebar(page)
    await shot(page, '2b-projects-sidebar')
    await page.locator('button', { hasText: 'Новый проект' }).first().click()
    await page.waitForSelector('[data-testid="new-project-dialog"]')
    await page.selectOption('[data-testid="new-project-dialog"] select', 'type-software')
    await page.waitForTimeout(400)
    await shot(page, '3-new-project-dialog')
    await page.keyboard.press('Escape')

    // Список приглашений в сайдбаре: самый новый экран, снимаем отдельно.
    await page.goto(`${BASE}/#/projects`, { waitUntil: 'networkidle' })
    await openSidebar(page)
    if (await page.locator('.proj-invites-inbox').count()) {
      await shot(page, '7-invitations-inbox')
    }

    // Экран приглашения у вошедшего: принять или отклонить.
    if (INVITE) {
      await page.goto(`${BASE}/#/project-invite/${INVITE}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(800)
      if (await page.locator('[data-testid="invite-screen"]').count()) {
        await shot(page, '8-invite-authed')
      }
    }

    if (PROJECT) {
      await page.goto(`${BASE}/#/projects/${PROJECT}/settings`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)
      await shot(page, '4-settings-general')
      await page.locator('[role="tab"]', { hasText: 'Участники' }).click()
      await page.waitForTimeout(800)
      await shot(page, '5-settings-members')

      // Доска и карточка задачи — главные экраны раздела, и до этого прогон в них
      // не заходил вовсе: падающий порог сторожит только те экраны, которые
      // открыты, поэтому мелкие цели на доске он пропускал.
      await page.goto(`${BASE}/#/projects/${PROJECT}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1800)
      if (await page.locator('[data-testid="kanban-board"]').count()) {
        await shot(page, '9-board')
        // Лента фильтров на телефоне свёрнута — состояние достижимо только действием.
        const filters = page.locator('[data-testid="board-filters-shell"] summary')
        if (await filters.count()) {
          await filters.first().click()
          await page.waitForTimeout(500)
          await shot(page, '9b-board-filters')
          await filters.first().click()
          await page.waitForTimeout(300)
        }
        const card = page.locator('[data-testid="task-card"]')
        if (await card.count()) {
          await card.first().click()
          await page.waitForTimeout(1200)
          await shot(page, '10-task-modal')
          await page.keyboard.press('Escape')
          await page.waitForTimeout(400)
        }
      }
    }

    // Каталог типов в пользовательских настройках. Меню аккаунта живёт в
    // боковой панели, поэтому её надо раскрыть заново: предыдущие шаги могли
    // увести на другой маршрут и закрыть её.
    await page.goto(`${BASE}/#/projects`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    await openSidebar(page)
    const account = page.locator('.acct-toggle')
    if (await account.count()) {
      await account.first().click()
      await page.waitForTimeout(400)
      const settings = page.locator('button[role="menuitem"]', { hasText: 'Настройки' })
      if (await settings.count()) {
        await settings.first().click()
        await page.waitForTimeout(1200)
        const tab = page.locator('.vc-dialog button, [role="dialog"] button', { hasText: 'Типы проектов' })
        if (await tab.count()) {
          await tab.first().click()
          await page.waitForTimeout(800)
          await shot(page, '6-project-types-settings')
        }
      }
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}

if (problems.length) {
  console.log('\nПроблемы мобильной раскладки:')
  for (const p of problems) console.log(` • [${p.screen}] ${p.kind === 'overflow' ? 'горизонтальный вылет' : 'мелкие цели нажатия'}: ${p.detail}`)
  process.exitCode = 1
} else {
  console.log('\nГоризонтального вылета и мелких целей нет.')
}
