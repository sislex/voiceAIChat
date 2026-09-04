import { join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { installTrustedCa, readExtraCaPem } from './trustedCa.js'
import { previewOriginTarget, parseHostAliases } from './security.js'
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
const extraCa = readExtraCaPem({ base64: process.env.VC_BROWSER_EXTRA_CA_B64, pem: process.env.VC_BROWSER_EXTRA_CA_PEM, file: process.env.VC_BROWSER_EXTRA_CA_FILE })
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

// Адреса собственного стенда: контейнер не достаёт до публичного IP своего же
// хоста, но ходит к соседнему сервису по имени в сети compose.
const hostAliases = parseHostAliases(process.env.VC_BROWSER_HOST_ALIASES)
if (hostAliases.size) console.log(`[browser-runner] алиасов адресов: ${hostAliases.size}`)
// Адрес сервера для браузерных проверок задач: без него Chromium не откроет
// прокси превью — имя сервера в сети compose ведёт в приватную сеть.
const previewOrigin = previewOriginTarget(process.env.VC_BROWSER_PREVIEW_ORIGIN)
if (previewOrigin) console.log(`[browser-runner] доверенный origin сервера: ${previewOrigin}`)
const app = await buildBrowserRunner({ token, profilesRoot, hostAliases, previewOrigin })

await app.listen({ port, host })
console.log(`[browser-runner] listening on http://${host}:${port}`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)))
}
