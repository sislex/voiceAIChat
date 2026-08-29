import { join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { installTrustedCa, readExtraCaPem } from './trustedCa.js'
import { buildBrowserRunner } from './server.js'

const token = process.env.VC_BROWSER_RUNNER_TOKEN ?? ''
if (!token) {
  console.error('[browser-runner] VC_BROWSER_RUNNER_TOKEN is required')
  process.exit(1)
}

const port = Number(process.env.PORT ?? 8791)
const host = process.env.HOST ?? '0.0.0.0'
const profilesRoot = resolve(process.env.VC_BROWSER_DATA_DIR ?? './data/browser-profiles')

// Дополнительные корневые сертификаты: наши стенды стоят за Caddy с внутренним
// центром, чей корень не входит в публичные списки доверия. Без этого
// изолированный Chromium не открывает собственный сайт проекта.
const extraCa = readExtraCaPem({ file: process.env.VC_BROWSER_EXTRA_CA_FILE, pem: process.env.VC_BROWSER_EXTRA_CA_PEM })
if (extraCa.error) console.warn(`[browser-runner] дополнительный CA не прочитан: ${extraCa.error}`)
if (extraCa.pem) {
  const dbDir = join(process.env.HOME ?? '/tmp', '.pki', 'nssdb')
  await mkdir(dbDir, { recursive: true })
  const result = await installTrustedCa(extraCa.pem, dbDir, (args, input) => new Promise((done) => {
    const child = spawn('certutil', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => done({ ok: false, output: error.message }))
    child.on('close', (code) => done({ ok: code === 0, output }))
    if (input) child.stdin.end(input); else child.stdin.end()
  }))
  if (result.error) console.warn(`[browser-runner] доверие дополнительному CA не настроено: ${result.error}`)
  else console.log(`[browser-runner] доверенных корневых сертификатов добавлено: ${result.added}`)
}

const app = await buildBrowserRunner({ token, profilesRoot })

await app.listen({ port, host })
console.log(`[browser-runner] listening on http://${host}:${port}`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)))
}
