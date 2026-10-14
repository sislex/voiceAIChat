import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensureChromium, headlessExecutablePath } from './ensure-playwright-browser.mjs'

const executablePath = '/browser-cache/chromium_headless_shell-123/chrome-headless-shell'
const noSpawn = () => assert.fail('must not spawn')

test('the default executable is the Playwright headless shell', () => {
  assert.match(headlessExecutablePath(), /chromium_headless_shell-\d+/)
})

test('present shell needs no install, even offline', () => {
  ensureChromium({ executablePath, exists: path => path === executablePath, spawn: noSpawn,
    env: { VC_PLAYWRIGHT_OFFLINE: '1' } })
})

test('missing shell installs once and passes the inherited environment unchanged', () => {
  const env = { PLAYWRIGHT_BROWSERS_PATH: '/browser-cache', PATH: '/bin', CI: '1' }
  let installed = false, calls = 0
  ensureChromium({ executablePath, env, exists: () => installed,
    spawn: (command, args, options) => {
      calls++
      assert.equal(command, 'npx')
      assert.deepEqual(args, ['playwright', 'install', 'chromium'])
      assert.equal(options.env, env)
      installed = true
      return { status: 0 }
    } })
  assert.equal(calls, 1)
})

for (const flag of ['VC_PLAYWRIGHT_OFFLINE', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD']) {
  test(`${flag}=1 fails without spawning when missing`, () => {
    assert.throws(() => ensureChromium({ executablePath, exists: () => false,
      spawn: noSpawn, env: { [flag]: '1' } }), error =>
      error.message.includes(`${flag}=1`) && error.message.includes('npx playwright install chromium'))
  })
}

test('install failure includes the output tail and does not retry', () => {
  let calls = 0
  assert.throws(() => ensureChromium({ executablePath, exists: () => false, env: {},
    spawn: () => { calls++; return { status: 1, stdout: 'x'.repeat(9000) + 'download failed', stderr: 'network unavailable' } }
  }), error => error.message.includes('download failed\nnetwork unavailable') && error.message.length < 8500)
  assert.equal(calls, 1)
})

test('spawn errors and signals are reported', () => {
  for (const result of [{ error: new Error('spawn npx ENOENT') }, { status: null, signal: 'SIGTERM' }]) {
    assert.throws(() => ensureChromium({ executablePath, exists: () => false, env: {},
      spawn: () => result }), /spawn npx ENOENT|SIGTERM/)
  }
})

test('successful installer must leave the shell present', () => {
  assert.throws(() => ensureChromium({ executablePath, exists: () => false, env: {},
    spawn: () => ({ status: 0 }) }), /headless shell is still missing/)
})
