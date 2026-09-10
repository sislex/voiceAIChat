import { loadWebReaderConfig } from './config.js'
import { buildReaderServer } from './server.js'
const config = loadWebReaderConfig()
const { app } = await buildReaderServer({ config, logger: true })
await app.listen({ host: config.host, port: config.port })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().catch((error) => { app.log.error(error); process.exitCode = 1 }) })
