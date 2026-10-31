import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createComponentRuntime } from '@sislexa/component-runtime'
import { createStorageNodeServer } from './server.js'

const env = process.env
const runtime = env.SISLEXA_COMPONENT_CONFIG ? await createComponentRuntime({
  contractFile: env.SISLEXA_COMPONENT_CONTRACT ?? fileURLToPath(new URL('../../component-contract.json', import.meta.url)),
  configFile: env.SISLEXA_COMPONENT_CONFIG,
  metadata: { applicationId: 'file-storage', version: '0.1.0', apiVersion: '1.0.0', dataVersion: '1.0.0',
    commit: env.VC_APPLICATION_COMMIT ?? '0000000000000000000000000000000000000000' },
}) : undefined
try {
  const app = await createStorageNodeServer({
    nodeId: env.VC_FILE_STORAGE_NODE_ID ?? '',
    directory: env.VC_FILE_STORAGE_DIR ?? '',
    capacityBytes: env.VC_FILE_STORAGE_CAPACITY_BYTES ? Number(env.VC_FILE_STORAGE_CAPACITY_BYTES) : NaN,
    tokenFile: env.VC_FILE_STORAGE_TOKEN_FILE, runtime,
    directSecret: env.VC_FILE_STORAGE_DIRECT_SECRET_FILE ? (await readFile(env.VC_FILE_STORAGE_DIRECT_SECRET_FILE, 'utf8')).trim() : undefined,
    corsOrigins: (env.VC_FILE_STORAGE_CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
  })
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close() })
  await app.listen({ host: env.HOST ?? '0.0.0.0', port: Number(env.PORT ?? 8795) })
} catch (error) {
  runtime?.close()
  throw error
}
