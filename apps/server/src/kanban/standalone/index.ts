// Точка входа отдельного процесса канбана: `node --import tsx src/kanban/standalone/index.ts`.
// Конфигурация — те же env, что у ядра (общий `.env` compose), плюс `VC_CORE_URL`; порт по умолчанию 8789.
import { loadConfig } from '../../config.js'
import { buildKanbanServer } from './server.js'

if (!process.env.PORT) process.env.PORT = '8789'
const config = loadConfig()
const coreUrl = config.coreUrl ?? 'http://127.0.0.1:8787'
for (const [ok, message] of [
  [Boolean(config.internalToken), 'VC_INTERNAL_TOKEN is required (тот же, что у ядра)'],
  [Boolean(config.mcpSecret), 'VC_MCP_SECRET is required (тот же, что у ядра)'],
  [Boolean(config.dbUrl), 'VC_DB_URL is required (общая база Postgres)']
] as const) {
  if (!ok) { console.error(message); process.exit(1) }
}
const { app, db } = await buildKanbanServer({ config, coreUrl, logger: true, version: process.env.VC_RELEASE_VERSION || null })
app.log.info({ engine: db.engine, coreUrl }, 'kanban: отдельный процесс')
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: config.port })
