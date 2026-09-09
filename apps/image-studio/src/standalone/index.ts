import { loadImageStudioStandaloneConfig } from './config.js'
import { buildImageStudioServer } from './server.js'

const config = loadImageStudioStandaloneConfig()
const { app } = await buildImageStudioServer({ config, logger: true })
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().catch((error) => { app.log.error(error); process.exitCode = 1 }) })
}
await app.listen({ host: config.host, port: config.port })
