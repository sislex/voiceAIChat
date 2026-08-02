// Точка входа сервера.

import { buildServer } from './server.js'
import { loadConfig } from './config.js'
import { mcpBaseMisconfigured } from './mcp/publicBase.js'

const config = loadConfig()

if (mcpBaseMisconfigured(config)) {
  console.warn(
    '[server] VC_MCP_PUBLIC_BASE не задан при настроенном исполнителе LLM: ' +
      'MCP-инструменты (mcp__remote__*, mcp__kb__*) не появятся у модели — ' +
      'из контейнера исполнителя loopback ведёт в него самого. ' +
      'Укажите адрес сервера, видимый исполнителю (в compose — http://voicechat:8787).'
  )
}

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
