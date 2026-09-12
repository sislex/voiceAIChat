import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

await mkdir('.generated_images', { recursive: true })

const browser = await chromium.launch({ headless: true })
const base = process.env.CHAT445_STORYBOOK_URL ?? 'http://localhost:6045'
const panels = ['overview', 'reworks', 'preparation', 'settings', 'progress', 'component-qa', 'integration', 'automated-qa', 'manual-qa', 'merge', 'feed']
// @testCase TC-UI-01
try {
  for (const theme of ['light', 'dark']) for (const width of [390, 1280]) for (const panel of panels) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base + '/iframe.html?id=kanban-newtaskcard-functionalpanels--' + panel + '&viewMode=story&globals=theme:' + theme)
    await page.locator('.new-task-process, .new-task-settings, .new-task-card').first().waitFor({ timeout: 60000 })
    await page.waitForFunction(() => !document.querySelector('[aria-label="Карточка загружается"]'))
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.locator('.task-preparation-tab, .component-qa-panel, .qa-stage-panel, .manual-qa, .merge-panel, .ci-runfeed, .ci-task').count(), 0, panel + ': legacy panel mounted')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    assert.equal(overflow, false, panel + ': horizontal page overflow at ' + width)
    assert.deepEqual(errors, [], panel + ': browser errors')
    await page.screenshot({ path: '.generated_images/' + panel + '-' + theme + '-' + width + '.png', fullPage: true })
    console.log('PASS', panel, theme, width)
    await page.close()
  }
} finally { await browser.close() }
