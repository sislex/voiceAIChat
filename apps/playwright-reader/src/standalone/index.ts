import { loadPlaywrightReaderConfig } from './config.js'
import { buildPlaywrightReaderServer } from './server.js'

const config = loadPlaywrightReaderConfig()
const { app } = await buildPlaywrightReaderServer({ config, logger: true })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close() })
await app.listen({ host: config.host, port: config.port })
