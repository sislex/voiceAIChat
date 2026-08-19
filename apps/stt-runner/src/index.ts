// Точка входа изолированного исполнителя STT.

import { buildRunner } from './server.js'
import { loadSttRunnerConfig } from './config.js'

const config = loadSttRunnerConfig()

if (!config.token) {
  console.error('[stt-runner] VC_STT_RUNNER_TOKEN не задан — исполнитель не запущен')
  process.exit(1)
}

const app = await buildRunner({ config })

app
  .listen({ port: config.port, host: config.host })
  .then(() => {
    console.log(`[stt-runner] listening on http://${config.host}:${config.port}`)
  })
  .catch((err) => {
    console.error('[stt-runner] failed to start', err)
    process.exit(1)
  })

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    // Раны гасит onClose приложения: брошенный CLI переживёт контейнер.
    void app.close().then(() => process.exit(0))
  })
}
