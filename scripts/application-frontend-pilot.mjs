// Реальный переход UI-версии через неизменный собранный host и его HTTP gateway.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { chromium } from 'playwright'
import { compatibilityCompose } from './application-compatibility.mjs'
import {
  createDockerRuntime,
  deployApplications
} from './application-deploy.mjs'
import { verifyCompatibility } from '../apps/make/compatibility.mjs'
const token = 'compatibility-isolated-local-only'
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024
  })
const hash = (value) => createHash('sha256').update(value).digest('hex')
export async function pilotMakeFrontend(
  core,
  make,
  previous,
  candidate,
  { development = false } = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'vc-ui-pilot-')),
    projectName = 'vc-ui-pilot-' + randomUUID().slice(0, 10),
    file = join(dir, 'compose.json'),
    stateDir = join(dir, 'state')
  mkdirSync(stateDir)
  const compose = compatibilityCompose(previous, [core, make])
  compose.services['make-ui'].volumes = ['frontend-assets:/data']
  compose.volumes = { 'frontend-assets': {} }
  writeFileSync(file, JSON.stringify(compose), { mode: 0o600 })
  const base = ['compose', '-p', projectName, '-f', file]
  const runtime = createDockerRuntime(
    {
      projectId: projectName,
      environment: 'staging',
      projectName,
      composeFiles: [file],
      stateDir,
      health: {
        voicechat: { port: 8080, path: '/api/health' },
        make: { port: 8080, path: '/v1/health' },
        'make-ui': { port: 8080, path: '/v1/health' }
      }
    },
    docker,
    { allowDevelopment: development }
  )
  let browser
  try {
    docker([...base, 'up', '-d', '--no-build', '--pull', 'never'])
    let observed
    for (let i = 0; i < 45; i++) {
      observed = runtime.observe()
      if (
        observed.applications.length === 3 &&
        observed.applications.every((app) => app.healthy)
      )
        break
      if (i === 44) throw new Error('Не поднялся UI-стенд')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    assert.ok(runtime.linksHealthy(observed))
    const urls = Object.fromEntries(
      runtime
        .inventory()
        .map((item) => [
          item.Config.Labels['com.docker.compose.service'],
          'http://127.0.0.1:' +
            item.NetworkSettings.Ports['8080/tcp'][0].HostPort
        ])
    )
    const stable = () =>
      Object.fromEntries(
        runtime
          .inventory()
          .filter(
            (item) =>
              item.Config.Labels['com.docker.compose.service'] !== 'make-ui'
          )
          .map((item) => [
            item.Config.Labels['com.docker.compose.service'],
            item.Id
          ])
      )
    const originalIds = stable(),
      data = await verifyCompatibility({ urls, token }),
      coreBase = urls.voicechat
    assert.equal(
      (
        await fetch(coreBase + '/api/settings', {
          method: 'PUT',
          headers: {
            authorization: 'Bearer ' + data.auth,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ onboarded: true })
        })
      ).status,
      200
    )
    const json = async (path) => {
      const response = await fetch(coreBase + path)
      assert.equal(response.status, 200)
      return response.json()
    }
    const oldManifest = await json('/applications/make-ui/manifest.json'),
      oldAsset = await (
        await fetch(
          coreBase + '/applications/make-ui/' + oldManifest.entry.path
        )
      ).text()
    const html = await (await fetch(coreBase + '/')).text(),
      hostPath = html.match(/src="([^"<>]*\/assets\/index-[^"<>]+\.js)"/)?.[1]
    assert.ok(hostPath, 'Стенду нужен собранный web host')
    const hostBefore = hash(await (await fetch(coreBase + hostPath)).text())
    browser = await chromium.launch()
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 }
      }),
      errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(coreBase)
    await page.evaluate(
      (auth) => localStorage.setItem('vc.session.token', auth),
      data.auth
    )
    await page.goto(coreBase + '/#/make/' + data.conversationId)
    await page.reload()
    await page.getByTestId('make-pane').waitFor({ timeout: 20000 })
    assert.equal(
      await page
        .locator('script[src$="' + oldManifest.entry.path + '"]')
        .count(),
      1
    )
    const update = await deployApplications(
      { previous: observed, releases: [candidate] },
      runtime,
      { attempts: 8 }
    )
    assert.equal(update.status, 'released')
    assert.deepEqual(stable(), originalIds)
    const newManifest = await json('/applications/make-ui/manifest.json')
    assert.equal(newManifest.version, candidate.version)
    assert.notEqual(newManifest.entry.path, oldManifest.entry.path)
    assert.equal(
      hash(await (await fetch(coreBase + hostPath)).text()),
      hostBefore
    )
    assert.equal(
      await (
        await fetch(
          coreBase + '/applications/make-ui/' + oldManifest.entry.path
        )
      ).text(),
      oldAsset
    )
    // Открытая до deploy панель продолжает получать свои поздние assets/workers.
    await page.getByRole('tab', { name: 'Код', exact: true }).click()
    await page.getByRole('button', { name: /^index\.html/ }).click()
    await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 })
    await page.reload()
    await page.getByTestId('make-pane').waitFor({ timeout: 20000 })
    assert.equal(
      await page
        .locator('script[src$="' + newManifest.entry.path + '"]')
        .count(),
      1
    )
    const rollback = await deployApplications(
      { previous: update.environment, releases: [previous] },
      runtime,
      { attempts: 8 }
    )
    assert.equal(rollback.status, 'released')
    assert.deepEqual(stable(), originalIds)
    assert.equal(
      (await json('/applications/make-ui/manifest.json')).version,
      previous.version
    )
    assert.deepEqual(errors, [])
    return {
      development,
      coreVersion: core.version,
      previous: previous.version,
      next: candidate.version,
      untouchedContainers: originalIds,
      hostBundle: hostBefore,
      oldAssetsRetained: true,
      update,
      rollback
    }
  } finally {
    await browser?.close()
    try {
      docker([...base, 'down', '--volumes', '--remove-orphans'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2),
    value = (flag) => args[args.indexOf(flag) + 1],
    read = (flag) => JSON.parse(readFileSync(value(flag), 'utf8'))
  const result = await pilotMakeFrontend(
    read('--core'),
    read('--make'),
    read('--old'),
    read('--new'),
    { development: args.includes('--development') }
  )
  const output = JSON.stringify(result, null, 2) + '\n'
  if (args.includes('--output')) writeFileSync(value('--output'), output)
  else console.log(output)
}
