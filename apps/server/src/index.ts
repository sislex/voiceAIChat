// Точка входа сервера.

import { buildServer } from './server.js'
import { loadConfig } from './config.js'

const config = loadConfig()

const app = await buildServer({ config })

app
  .listen({ port: config.port, host: config.host })
  .then(() => {
    console.log(`[server] listening on http://${config.host}:${config.port}`)
  })
  .catch((err) => {
    console.error('[server] failed to start', err)
    process.exit(1)
  })

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void app.close().then(() => process.exit(0))
  })
}
