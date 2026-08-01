// Точка входа исполнителя LLM.

import { buildRunner } from './server.js'
import { loadRunnerConfig } from './config.js'

const config = loadRunnerConfig()

if (!config.token) {
  console.error('[llm-runner] VC_RUNNER_TOKEN не задан — исполнитель не запущен')
  process.exit(1)
}

const app = await buildRunner({ config })

app
  .listen({ port: config.port, host: config.host })
  .then(() => {
    console.log(`[llm-runner] listening on http://${config.host}:${config.port}`)
  })
  .catch((err) => {
    console.error('[llm-runner] failed to start', err)
    process.exit(1)
  })

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    // Раны гасит onClose приложения: брошенный CLI переживёт контейнер.
    void app.close().then(() => process.exit(0))
  })
}
