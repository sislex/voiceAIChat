// @ts-check
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function headlessExecutablePath() {
  // Playwright 1.62's launch() uses this registry entry, not chromium.executablePath().
  // The registry also handles platform revisions and PLAYWRIGHT_BROWSERS_PATH.
  const registryModule = ['playwright-core', 'lib/coreBundle'].join('/')
  const { registry } = require(registryModule).registry
  return registry.findExecutable('chromium-headless-shell').executablePath()
}

export function ensureChromium({
  executablePath = headlessExecutablePath(),
  exists = existsSync,
  spawn = spawnSync,
  env = process.env
} = {}) {
  if (exists(executablePath)) return
  for (const flag of ['VC_PLAYWRIGHT_OFFLINE', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD']) {
    if (env[flag] === '1') {
      throw new Error(`Playwright Chromium headless shell is missing at ${executablePath}; ${flag}=1 disables automatic download. Install it with npx playwright install chromium before running browser gates.`)
    }
  }
  const result = spawn('npx', ['playwright', 'install', 'chromium'], {
    env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024
  })
  const tail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().slice(-8000)
  if (result.error || result.status !== 0) {
    throw new Error(`Playwright Chromium install failed (${result.error?.message ?? result.signal ?? result.status}).\n${tail}`)
  }
  if (!exists(executablePath)) {
    throw new Error(`Playwright Chromium install finished but headless shell is still missing at ${executablePath}.\n${tail}`)
  }
}

export default function setup() {
  ensureChromium()
}
