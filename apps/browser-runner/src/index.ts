import { resolve } from 'node:path'
import { buildBrowserRunner } from './server.js'

const token = process.env.VC_BROWSER_RUNNER_TOKEN ?? ''
if (!token) {
  console.error('[browser-runner] VC_BROWSER_RUNNER_TOKEN is required')
  process.exit(1)
}

const port = Number(process.env.PORT ?? 8791)
const host = process.env.HOST ?? '0.0.0.0'
const profilesRoot = resolve(process.env.VC_BROWSER_DATA_DIR ?? './data/browser-profiles')
const app = await buildBrowserRunner({ token, profilesRoot })

await app.listen({ port, host })
console.log(`[browser-runner] listening on http://${host}:${port}`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)))
}
