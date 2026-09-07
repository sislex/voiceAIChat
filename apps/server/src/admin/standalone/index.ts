// Точка входа отдельного процесса админки: `node --import tsx src/admin/standalone/index.ts`.
// Конфигурация — те же env, что у ядра, плюс `VC_CORE_URL` (и `VC_MACHINES_URL`, если машины тоже отдельно); порт по умолчанию 8794.
import { loadConfig } from '../../config.js'
import { buildAdminServer } from './server.js'

if (!process.env.PORT) process.env.PORT = '8794'
const config = loadConfig()
const coreUrl = config.coreUrl ?? 'http://127.0.0.1:8787'
for (const [ok, message] of [
  [Boolean(config.internalToken), 'VC_INTERNAL_TOKEN is required (тот же, что у ядра)'],
  [Boolean(config.mcpSecret), 'VC_MCP_SECRET is required (тот же, что у ядра)'],
  [Boolean(config.dbUrl), 'VC_DB_URL is required (общая база Postgres)']
] as const) {
  if (!ok) { console.error(message); process.exit(1) }
}
const { app, db } = await buildAdminServer({ config, coreUrl, logger: true, version: process.env.VC_RELEASE_VERSION || null })
app.log.info({ engine: db.engine, coreUrl }, 'admin: отдельный процесс')
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: config.port })
