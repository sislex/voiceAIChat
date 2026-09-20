
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, createWriteStream, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, relative } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { chromium, _electron as electron } from 'playwright'
import { COMPRESSION, inventory, totals, resourceSet, sizes, completedResource } from './route-budgets.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function reportHtml(report) {
  const esc = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
  const sections = Object.entries(report.routes).map(([id, route]) => {
    const end = Math.max(1, ...route.waterfall.map(row => row.start + row.duration))
    const rows = route.waterfall.map(row => {
      const size = report.resources[row.resource]
      return '<tr><th>' + esc(row.resource) + '</th><td>' + size.raw + '</td><td>' + size.gzip + '</td><td>' + size.brotli + '</td><td class="timeline"><i style="left:' + (row.start / end * 100) + '%;width:' + Math.max(0.2, row.duration / end * 100) + '%"></i></td><td>' + row.start.toFixed(1) + ' + ' + row.duration.toFixed(1) + ' ms</td></tr>'
    }).join('')
    return '<section><h2>' + esc(id) + '</h2><pre>' + esc(JSON.stringify(route.totals)) + '</pre><table><thead><tr><th>Unique resource / request</th><th>raw</th><th>gzip 9</th><th>Brotli 11</th><th>Waterfall</th><th>start + duration</th></tr></thead><tbody>' + rows + '</tbody></table></section>'
  }).join('')
  const graph = Object.entries(report.resources).map(([id, resource]) => id + '\n  static: ' + resource.imports.join(', ') + '\n  dynamic: ' + resource.dynamicImports.join(', ')).join('\n')
  return '<!doctype html><html lang="en"><meta charset="utf-8"><title>Route measurements</title><style>body{font:14px system-ui;margin:24px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px;border-bottom:1px solid #bbb}th{overflow-wrap:anywhere;max-width:480px}.timeline{position:relative;min-width:180px}i{position:absolute;height:12px;background:#376bc7;top:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{margin-block:32px}</style><h1>Route measurements</h1><pre>' + esc(JSON.stringify({ commit: report.commit, conditions: report.conditions, tools: report.tools }, null, 2)) + '</pre>' + sections + '<details><summary>Complete chunk graph (static and dynamic edges)</summary><pre>' + esc(graph) + '</pre></details></html>'
}
export async function measure({ web, desktop, output }) {
  const data = mkdtempSync(join(tmpdir(), 'vc-route-measure-'))
  mkdirSync(output, { recursive: true })
  const port = 19000 + Math.floor(Math.random() * 10000), base = 'http://127.0.0.1:' + port
  const log = createWriteStream(join(output, 'server.log'))
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: join(root, 'apps/server'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', VC_DATA_DIR: data, VC_WEB_DIR: resolve(web), VC_ADMIN_PASSWORD: 'measurement-fixture-password', VITEST: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  server.stdout.pipe(log); server.stderr.pipe(log)
  let browser, desktopApp
  try {
    let healthy = false
    for (let i = 0; i < 90; i++) {
      try { healthy = (await fetch(base + '/api/health')).ok } catch {}
      if (healthy) break
      if (server.exitCode !== null) throw new Error('Fixture server exited: ' + server.exitCode)
      await delay(1000)
    }
    if (!healthy) throw new Error('Fixture server health timeout')
    const login = await fetch(base + '/api/session/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: 'measurement-fixture-password' }) })
    const { token } = await login.json()
    if (!token) throw new Error('Fixture login failed')
    const settings = await fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ onboarded: true }) })
    if (!settings.ok) throw new Error('Fixture settings failed')
    const api = async (path, body) => {
      const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('Fixture seed failed: ' + path + ' ' + response.status)
      return response.json()
    }
    const conversation = await api('/api/conversations', { title: 'Bundle measurement', execTarget: 'none' })
    await api('/api/conversations/' + conversation.id + '/messages', { role: 'ai', text: 'Measurement fixture **ready**.\n\n\x60\x60\x60js\nconst answer = 42\n\x60\x60\x60', time: '2026-09-15T00:00:00.000Z', engine: 'claude' })
    const report = { schemaVersion: 1, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
      compression: COMPRESSION, conditions: { scenario: 'returning admin, onboarded, existing chat with a fixed Markdown/code message; no optional-surface intent', viewport: { width: 1440, height: 900 }, theme: 'light', settleMs: 5000, transport: 'localhost HTTP and Electron file; Electron signs in through UI on each navigation because the HTTP fixture cookie is cross-site from file origin; compression calculated per resource', node: process.version, zlib: process.versions.zlib, brotli: process.versions.brotli, cpu: 'unthrottled', network: 'unthrottled loopback; Google font stylesheet fetched and measured', cache: 'CDP clearBrowserCache for cold, same context reload for warm' },
      resources: {}, routes: {}, tools: {}, activations: {} }
    report.conditions.actualViewports = {}
    for (const [client, directory] of [['web', web], ['electron', desktop]]) {
      console.log('Inventory ' + client)
      const cachePath = join(output, client + '-inventory.json')
      let assets
      try { if (!process.env.VC_MEASURE_REUSE_INVENTORY) throw new Error('Fresh build inventory required'); assets = JSON.parse(readFileSync(cachePath, 'utf8')) } catch { assets = inventory(directory); writeFileSync(cachePath, JSON.stringify(assets)) }
      for (const [id, value] of Object.entries(assets)) report.resources[client + '/' + id] = { ...value, imports: value.imports.map(x => client + '/' + x), dynamicImports: value.dynamicImports.map(x => client + '/' + x) }
      let page
      if (client === 'web') {
        browser = await chromium.launch()
        report.tools.web = browser.version()
        page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
        await page.goto(base)
      } else {
        desktopApp = await electron.launch({ executablePath: createRequire(join(root, 'apps/desktop/package.json'))('electron'), args: ['--no-sandbox', join(root, 'scripts/measure-electron.cjs')],
          env: { ...process.env, VC_MEASURE_HTML: resolve(directory, 'index.html'), VC_MEASURE_BASE: base, VC_MEASURE_USER_DATA: join(data, 'electron') } })
        page = await desktopApp.firstWindow()
        report.tools.electron = await desktopApp.evaluate(() => process.versions.electron)
      }
      report.conditions.actualViewports[client] = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio }))
      await page.addInitScript(t => { localStorage.setItem('vc.session.token', t); localStorage.setItem('vc:shell:admin:tour', 'true') }, token)
      await page.evaluate(id => { location.hash = '/chat/' + id }, conversation.id)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Network.enable')
      const requests = new Map()
      const externalBodies = []
      cdp.on('Network.requestWillBeSent', event => requests.set(event.requestId, { url: event.request.url, start: event.timestamp * 1000, duration: 0, transfer: 0, decoded: 0, initiator: event.initiator.type, status: -1 }))
      cdp.on('Network.responseReceived', event => {
        const row = requests.get(event.requestId)
        if (row) Object.assign(row, { status: event.response.status, mime: event.response.mimeType, fromCache: Boolean(event.response.fromDiskCache) })
      })
      cdp.on('Network.loadingFinished', event => {
        const row = requests.get(event.requestId)
        if (row) {
          Object.assign(row, { duration: event.timestamp * 1000 - row.start, transfer: event.encodedDataLength, finished: true })
          if (row.mime === 'text/css' && row.url.startsWith('https://')) {
            externalBodies.push(cdp.send('Network.getResponseBody', { requestId: event.requestId }).then(result => {
              const body = Buffer.from(result.body, result.base64Encoded ? 'base64' : 'utf8')
              const hash = createHash('sha256').update(body).digest('hex')
              // Distinct URLs still cost separate resources even if their bodies match.
              row.resource = client + '/external/' + createHash('sha256').update(row.url).digest('hex') + '.css'
              if (report.resources[row.resource] && report.resources[row.resource].sha256 !== hash) throw new Error('External stylesheet changed during measurement')
              report.resources[row.resource] = { type: 'css', sha256: hash, ...sizes(body), imports: [], dynamicImports: [], source: new URL(row.url).origin }
            }).catch(error => { row.bodyError = error.message }))
          }
        }
      })
      cdp.on('Network.loadingFailed', event => {
        const row = requests.get(event.requestId)
        if (row) Object.assign(row, { status: -1, finished: true })
      })
      const collect = async (routeKey, errors, baseline = []) => {
        await Promise.all(externalBodies)
        const entries = [...requests.values()]
        const originTime = Math.min(...entries.map(entry => entry.start))
        const waterfall = []
        for (const entry of entries) {
          const url = new URL(entry.url)
          if (entry.bodyError) throw new Error('Incomplete external CSS measurement: ' + entry.bodyError)
          if (entry.resource) {
            waterfall.push({ resource: entry.resource, start: entry.start - originTime, duration: entry.duration, transfer: entry.transfer, status: entry.status, fromCache: entry.fromCache || entry.status === 304, ok: completedResource(entry) })
            continue
          }
          if (url.hostname === 'fonts.googleapis.com') throw new Error('External font stylesheet unavailable')
          if (client === 'electron' && url.protocol !== 'file:') {
            if (/\.(js|css)$/i.test(url.pathname) || /(?:java|ecma)script|text\/css/.test(entry.mime ?? '')) throw new Error('Uninventoried external renderer resource ' + url.origin + url.pathname)
            continue
          }
          let id = client === 'web' ? decodeURIComponent(url.pathname).replace(/^\//, '') : relative(resolve(directory), fileURLToPath(url))
          if (!assets[id]) {
            if (/\.(js|css)$/i.test(url.pathname) || /(?:java|ecma)script|text\/css/.test(entry.mime ?? '')) throw new Error('Uninventoried resource ' + url.origin + url.pathname)
            continue
          }
          waterfall.push({ resource: client + '/' + id, start: entry.start - originTime, duration: entry.duration, transfer: entry.transfer, decoded: entry.decoded, initiator: entry.initiator, status: entry.status, fromCache: entry.fromCache || entry.status === 304, ok: completedResource(entry) })
        }
        const initial = resourceSet(report.resources, waterfall.map(r => r.resource))
        report.routes[routeKey] = { ready: true, initial, waterfall, totals: totals(report.resources, initial), errors, additionalResources: initial.filter(id => !baseline.includes(id)) }
        await page.screenshot({ path: join(output, routeKey.replaceAll('/', '-') + '.png') })
        if (errors.length) throw new Error(client + ' runtime errors: ' + errors.join('; '))
        console.log(routeKey, JSON.stringify(report.routes[routeKey].totals))
      }
      await cdp.send('Network.clearBrowserCache')
      for (const scenario of [{ name: 'chat', hash: '/chat/' + conversation.id }, { name: 'account', hash: '/account' }, { name: 'settings', hash: '/settings/ui' }]) for (const cache of ['cold', 'warm']) {
        const errors = []
        const onError = e => errors.push(e.message)
        page.on('pageerror', onError)
        if (cache === 'cold') await cdp.send('Network.clearBrowserCache')
        requests.clear()
        externalBodies.length = 0
        if (cache === 'cold') await page.goto((client === 'web' ? base + '/' : pathToFileURL(resolve(directory, 'index.html')).href) + '?measurement=' + scenario.name + '#' + scenario.hash)
        else await page.reload()
        if (client === 'electron') {
          await page.getByRole('button', { name: 'Войти', exact: true }).waitFor({ timeout: 60000 })
          await page.getByLabel('Пользователь', { exact: true }).fill('admin')
          await page.getByLabel('Пароль', { exact: true }).fill('measurement-fixture-password')
          await page.getByRole('button', { name: 'Войти', exact: true }).click()
          await page.evaluate(hash => { location.hash = hash }, scenario.hash)
        }
        await page.getByRole('button', { name: /admin/ }).first().waitFor({ timeout: 60000 }).catch(async error => { await page.screenshot({ path: join(output, client + '-failed.png') }); console.error(await page.locator('body').innerText(), errors); throw error })
        if (scenario.name === 'chat') await page.getByRole('textbox', { name: 'Поле ввода сообщения', exact: true }).waitFor({ timeout: 60000 })
        else if (scenario.name === 'account') await page.getByRole('heading', { name: 'Мой аккаунт', exact: true }).waitFor({ timeout: 60000 })
        else await page.getByLabel('Тема интерфейса').waitFor({ timeout: 60000 })
        await delay(5000)
        await collect(client + '/' + scenario.name + '/' + cache, errors)
        page.off('pageerror', onError)
      }
      for (const target of [{ name: 'account', hash: '/account' }, { name: 'settings', hash: '/settings/ui' }]) {
        await cdp.send('Network.clearBrowserCache')
        requests.clear(); externalBodies.length = 0
        const errors = [], onError = error => errors.push(error.message)
        page.on('pageerror', onError)
        await page.goto((client === 'web' ? base + '/' : pathToFileURL(resolve(directory, 'index.html')).href) + '?navigation=' + target.name + '#/chat/' + conversation.id)
        if (client === 'electron') {
          await page.getByRole('button', { name: 'Войти', exact: true }).waitFor({ timeout: 60000 })
          await page.getByLabel('Пользователь', { exact: true }).fill('admin')
          await page.getByLabel('Пароль', { exact: true }).fill('measurement-fixture-password')
          await page.getByRole('button', { name: 'Войти', exact: true }).click()
          await page.evaluate(id => { location.hash = '/chat/' + id }, conversation.id)
        }
        await page.getByRole('textbox', { name: 'Поле ввода сообщения', exact: true }).waitFor({ timeout: 60000 })
        await delay(5000)
        await page.evaluate(hash => { location.hash = hash }, target.hash)
        if (target.name === 'account') await page.getByRole('heading', { name: 'Мой аккаунт', exact: true }).waitFor({ timeout: 60000 })
        else await page.getByLabel('Тема интерфейса').waitFor({ timeout: 60000 })
        await delay(5000)
        await collect(client + '/' + target.name + '/navigation', errors, report.routes[client + '/chat/cold'].initial)
        page.off('pageerror', onError)
      }
      const editor = Object.keys(assets).find(id => /\/MonacoCodeEditor-[^/]+\.js$/.test(id))
      if (!editor) throw new Error(client + ': editor chunk missing')
      const workerUrls = []
      const onWorker = worker => workerUrls.push(worker.url())
      page.on('worker', onWorker)
      const editorUrl = client === 'web' ? base + '/' + editor : pathToFileURL(resolve(directory, editor)).href
      await page.evaluate(async url => {
        const host = window.VoiceChatApplicationHost
        if (!host) throw new Error('Application host missing')
        const module = await import(url)
        const container = document.createElement('div')
        container.style.cssText = 'position:fixed;inset:0;height:600px;z-index:99999'
        document.body.append(container)
        const root = host.reactDom.createRoot(container)
        root.render(host.react.createElement(module.default, { path: '/fixture.ts', value: 'const answer: number = 42', ariaLabel: 'Worker fixture', onChange: () => {} }))
      }, editorUrl)
      await page.locator('.monaco-editor').first().waitFor({ timeout: 60000 })
      for (let attempt = 0; attempt < 50 && !workerUrls.length; attempt++) await delay(100)
      if (!workerUrls.length) throw new Error(client + ': no real editor worker observed')
      report.activations[client + '/editor'] = { ready: true, workers: workerUrls.map(url => new URL(url).pathname.split('/').pop()) }
      page.off('worker', onWorker)
      writeFileSync(join(output, client + '-report.json'), JSON.stringify(report, null, 2))
      if (client === 'web') { await browser.close(); browser = null }
      else { await desktopApp.close(); desktopApp = null }
    }
    writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
    writeFileSync(join(output, 'report.html'), reportHtml(report))
    return report
  } finally {
    await browser?.close(); await desktopApp?.close()
    server.kill('SIGTERM')
    await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve) })
    log.end()
    await rm(data, { recursive: true, force: true })
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [web, desktop, output] = process.argv.slice(2)
  if (!web || !desktop || !output) throw new Error('usage: measure-routes WEB_DIST ELECTRON_DIST OUTPUT')
  await measure({ web, desktop, output })
}
