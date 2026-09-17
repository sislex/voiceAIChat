// Run after npm run build:storybook: node packages/ui/src/components/kanban/NewTaskCardView.browser.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const root = resolve(fileURLToPath(new URL('../../../storybook-static/', import.meta.url)))
const require = createRequire(import.meta.url)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }

// @testCase TC1
// @testCase TC7
test('new task stories are accessible and fit desktop and 390px viewports', async () => {
  const server = createServer(async (request, response) => {
    const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname)
    if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return }
    try {
      response.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream')
      response.end(await readFile(path))
    } catch { response.writeHead(404).end() }
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const browser = await chromium.launch({ headless: true })
  try {
    const url = 'http://127.0.0.1:' + server.address().port
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      const pageErrors = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      for (const story of ['statement-editing', 'stage-with-error', 'mobile-rail']) {
        console.log('Checking', width, story)
        await page.goto(url + '/iframe.html?id=kanban-newtaskcard--' + story + '&viewMode=story')
        await page.getByRole('dialog', { name: /Задача CHAT/ }).waitFor().catch(async (error) => { console.log(story, await page.locator('body').innerText(), pageErrors); throw error })
        if (story === 'statement-editing') {
          const statement = page.getByRole('heading', { name: 'Актуальная постановка', exact: true }).locator('..').locator('..')
          await statement.getByRole('button', { name: 'Изменить', exact: true }).click()
          const edit = statement.locator('textarea').first()
          await edit.fill('Длинная строка '.repeat(80))
          assert.ok(await edit.evaluate((element) => element.offsetHeight > 80))
          await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
          await page.getByText('Длинная строка '.repeat(80).trim(), { exact: true }).waitFor()
          if (width === 390) {
            const details = page.locator('.new-task-side')
            assert.equal(await details.getAttribute('open'), null)
            await page.getByText('Workflow и задача', { exact: true }).click()
            assert.notEqual(await details.getAttribute('open'), null)
          }
        }
        if (story === 'stage-with-error') {
          await page.getByRole('button', { name: 'Повторить', exact: true }).click()
          await page.getByText('В очереди', { exact: true }).waitFor()
        }
        if (story === 'mobile-rail') {
          await page.locator('.new-task-title').click()
          assert.equal(await page.locator('.new-task-title').getAttribute('aria-expanded'), 'true')
          await page.getByRole('tab', { name: 'Общее', exact: true }).click()
        }
        if (process.env.CHAT449_SHOTS) {
          await mkdir(process.env.CHAT449_SHOTS, { recursive: true })
          await page.screenshot({ path: resolve(process.env.CHAT449_SHOTS, story + '-' + width + '.png'), fullPage: true })
        }
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
        const violations = await page.evaluate(async () => (await axe.run(document.body, { rules: { region: { enabled: false } } })).violations.map((item) => ({ id: item.id, impact: item.impact, targets: item.nodes.map((node) => node.target) })))
        assert.deepEqual(violations, [], story + ' axe at ' + width)
        const overflow = await page.evaluate(() => [document.documentElement, document.body, ...document.querySelectorAll('.new-task-body, .new-task-grid, .new-task-stage-rail')].filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.className || element.tagName))
        assert.deepEqual(overflow, [], story + ' overflow at ' + width)
        assert.deepEqual(pageErrors, [], story + ' browser errors')
      }
      await page.close()
    }
  } finally {
    await browser.close()
    await new Promise((done) => server.close(done))
  }
})
