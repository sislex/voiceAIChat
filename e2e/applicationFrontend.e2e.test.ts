import { beforeAll, afterAll, expect, it } from 'vitest'
import { createServer, build, type ViteDevServer } from 'vite'
import { chromium, type Browser, type Page } from 'playwright'
import { resolve, join } from 'node:path'
import { readFile, writeFile, mkdtemp, cp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
let server: ViteDevServer,
  browser: Browser,
  page: Page,
  base: string,
  directory: string
const errors: string[] = [],
  root = resolve(__dirname, '..')
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex')
const definitions = [
  {
    id: 'make-ui',
    pkg: 'make-app',
    mode: 'make',
    selector: '[data-testid="make-pane"]'
  },
  {
    id: 'image-studio-ui',
    pkg: 'image-studio-app',
    mode: 'image',
    selector: '.image-studio'
  },
  {
    id: 'playwright-reader-ui',
    pkg: 'playwright-reader-app',
    mode: 'reader',
    selector: '.playwright-browser-pane'
  },
  {
    id: 'web-reader-ui',
    pkg: 'web-reader-app',
    mode: 'web-reader',
    selector: '.webpreview'
  }
]
const requested = process.env.VC_E2E_APPLICATIONS?.split(',').filter(Boolean)
if (requested?.some((id) => !definitions.some((app) => app.id === id)))
  throw new Error('Неизвестное приложение E2E')
const selected = definitions.filter(
  (app) => !requested?.length || requested.includes(app.id)
)
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vc-panel-artifacts-'))
  for (const app of selected)
    await cp(join(root, 'packages', app.pkg, 'dist'), join(directory, app.id), {
      recursive: true
    })
  server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    resolve: {
      alias: [
        { find: /^@shared\//, replacement: root + '/packages/shared/src/' }
      ]
    },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'frontend-fixture',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url?.startsWith('/applications/')) {
              const path = req.url.slice('/applications/'.length).split('?')[0]!
              if (path.includes('..')) {
                res.statusCode = 404
                res.end()
                return
              }
              try {
                const body = await readFile(join(directory, path))
                res.setHeader('access-control-allow-origin', '*')
                res.setHeader(
                  'content-type',
                  path.endsWith('.json')
                    ? 'application/json'
                    : path.endsWith('.css')
                      ? 'text/css'
                      : 'text/javascript'
                )
                res.setHeader('cache-control', 'no-store')
                res.end(body)
              } catch {
                res.statusCode = 404
                res.end()
              }
              return
            }
            if (req.url?.split('?')[0] !== '/') return next()
            res.setHeader('content-type', 'text/html')
            res.end(
              await server.transformIndexHtml(
                '/',
                '<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/e2e/fixtures/application-frontend.tsx"></script></body></html>'
              )
            )
          })
        }
      }
    ]
  })
  await server.listen()
  base = server.resolvedUrls!.local[0]!
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (error) => errors.push(error.message))
})
afterAll(async () => {
  await browser?.close()
  await server?.close()
  if (directory) await rm(directory, { recursive: true, force: true })
})
it.each(selected)(
  '$id загружается через production-загрузчик и общий React',
  async (app) => {
    errors.length = 0
    await page.goto(base + '?panel=' + app.mode)
    await expect
      .poll(() => page.locator(app.selector).count(), { timeout: 15_000 })
      .toBe(1)
    expect(
      await page
        .locator(`script[src*="/applications/${app.id}/panel-"]`)
        .count()
    ).toBe(1)
    expect(
      await page.getByRole('textbox', { name: 'Сообщение' }).inputValue()
    ).toBe('Черновик чата')
    if (app.id === 'make-ui') {
      await page.getByRole('tab', { name: 'Код', exact: true }).click()
      await page.getByRole('button', { name: /^index\.html/ }).click()
      await page.locator('.monaco-editor').first().waitFor({ timeout: 30_000 })
      // Worker начинает работать после появления редактора; проверяем и его URL.
      await expect
        .poll(
          async () =>
            (
              await page.evaluate(() =>
                performance
                  .getEntriesByType('resource')
                  .map((entry) => entry.name)
              )
            ).some((url) => url.includes('/applications/make-ui/assets/')),
          { timeout: 15_000 }
        )
        .toBe(true)
    }
    expect(errors).toEqual([])
    const screenshots =
      process.env.VC_VISUAL_ARTIFACTS ??
      '/tmp/voicechat-application-frontends-browser'
    await mkdir(screenshots, { recursive: true })
    await page.screenshot({
      path: join(screenshots, app.id + '.png'),
      fullPage: true
    })
  }
)
it('Desktop file:// загружает HTTP-панель и её workers через тот же host API', async () => {
  const app = selected.find((app) => app.id === 'make-ui') ?? selected[0]!
  const output = join(directory, 'desktop')
  await build({
    configFile: false,
    root,
    base: './',
    logLevel: 'error',
    esbuild: { jsx: 'automatic', jsxDev: false },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: {
      alias: [
        { find: /^@shared\//, replacement: root + '/packages/shared/src/' }
      ]
    },
    build: {
      outDir: output,
      emptyOutDir: true,
      lib: {
        entry: join(root, 'e2e/fixtures/application-frontend.tsx'),
        formats: ['iife'],
        name: 'DesktopFixture',
        fileName: () => 'host.js'
      },
      rollupOptions: { output: { inlineDynamicImports: true } }
    }
  })
  await writeFile(
    join(output, 'index.html'),
    '<!doctype html><html lang="ru"><meta charset="utf-8"><link rel="stylesheet" href="style.css"><div id="root"></div><script src="host.js"></script></html>'
  )
  errors.length = 0
  await page.goto(
    pathToFileURL(join(output, 'index.html')).href +
      '?panel=' +
      app.mode +
      '&apiBase=' +
      encodeURIComponent(base.replace(/\/$/, ''))
  )
  try {
    await expect
      .poll(() => page.locator(app.selector).count(), { timeout: 20_000 })
      .toBe(1)
  } catch (error) {
    console.error(
      'Desktop diagnostics',
      errors,
      await page.locator('body').innerText()
    )
    throw error
  }
  if (app.id === 'make-ui') {
    await page.getByRole('tab', { name: 'Код', exact: true }).click()
    await page.getByRole('button', { name: /^index\.html/ }).click()
    await page.locator('.monaco-editor').first().waitFor({ timeout: 30_000 })
    await page.locator('.monaco-editor textarea').first().press('End')
  }
  expect(errors).toEqual([])
})
it('смена версии панели не меняет host bundle, повреждённый артефакт не исполняется', async () => {
  const app = selected[0]!
  const hostBefore = await (
    await fetch(base + 'packages/ui/src/runtime/applicationHost.tsx')
  ).text()
  const location = join(directory, app.id),
    manifestPath = join(location, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const entry = await readFile(join(location, manifest.entry.path), 'utf8')
  const next = entry.replaceAll(manifest.version, '1.1.0')
  expect(next).not.toBe(entry)
  manifest.version = '1.1.0'
  manifest.entry.path = `panel-${hash(next).slice(0, 20)}.js`
  manifest.entry.integrity =
    'sha384-' + createHash('sha384').update(next).digest('base64')
  await writeFile(join(location, manifest.entry.path), next)
  await writeFile(manifestPath, JSON.stringify(manifest))
  await page.goto(base + '?panel=' + app.mode)
  await expect
    .poll(() => page.locator(app.selector).count(), { timeout: 15_000 })
    .toBe(1)
  expect(
    await page.locator(`script[src$="${manifest.entry.path}"]`).count()
  ).toBe(1)
  expect(
    hash(
      await (
        await fetch(base + 'packages/ui/src/runtime/applicationHost.tsx')
      ).text()
    )
  ).toBe(hash(hostBefore))
  await writeFile(
    join(location, manifest.entry.path),
    'window.corruptArtifactExecuted=true'
  )
  await page.reload()
  await expect
    .poll(() => page.getByRole('alert').textContent())
    .toContain('Не удалось проверить приложение')
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { corruptArtifactExecuted?: boolean })
          .corruptArtifactExecuted
    )
  ).toBeUndefined()
  expect(
    await page.getByRole('textbox', { name: 'Сообщение' }).inputValue()
  ).toBe('Черновик чата')
})
