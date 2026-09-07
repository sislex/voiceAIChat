import { buildMakeServer } from './server.js'
import { loadMakeStandaloneConfig } from './config.js'

const config = loadMakeStandaloneConfig()
if (!config.internalToken) { console.error('VC_INTERNAL_TOKEN is required'); process.exit(1) }
if (!config.mcpSecret) { console.error('VC_MCP_SECRET is required (тот же, что у ядра)'); process.exit(1) }
const { app, make } = await buildMakeServer({ config, logger: true })
// Фоновая очистка Make (roadmap-2 п.16): снимки и PNG стори старше 30 дней, раз в 6 часов и при старте.
const sweep = async (): Promise<void> => {
  try { const r = await make.service.sweep(); if (r.snapshots || r.shots) app.log.info({ event: 'make_sweep', ...r }) } catch (error) { app.log.warn({ event: 'make_sweep_failed', error: String(error) }) }
}
const sweepTimer = setInterval(() => { void sweep() }, 6 * 60 * 60 * 1000)
sweepTimer.unref()
queueMicrotask(() => { void sweep() })
await app.listen({ host: config.host, port: config.port })
