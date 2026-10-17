import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function componentEnvironment(env) {
  // Kanban swaps the base Core container for this process and passes that container's own
  // configuration (devSwap.ts): its service URLs already reach the stand, so they are kept.
  // Only values the stand did not supply fall back to routing through the gateway.
  const provided = { ...env, VC_PORT: env.VC_PORT ?? env.PORT }
  for (const key of ['SISLEXA_STAND_URL', 'VC_DATA_DIR', 'VC_DB_URL', 'VC_PORT'])
    if (!provided[key]) throw Error(`dev:component requires stand allocation ${key}`)
  if (!['http:', 'https:'].includes(new URL(provided.SISLEXA_STAND_URL).protocol)) throw Error('Invalid SISLEXA_STAND_URL')
  const port = Number(provided.VC_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid allocated VC_PORT')
  const result = { ...provided, NODE_ENV: 'development', PORT: provided.VC_PORT, HOST: provided.VC_HOST ?? '0.0.0.0' }
  for (const name of ['KANBAN', 'MAKE', 'IMAGE_STUDIO', 'MACHINES', 'ADMIN', 'READER', 'PLAYWRIGHT_READER']) {
    result[`VC_${name}_MODE`] ??= 'remote'
    result[`VC_${name}_URL`] ??= provided.SISLEXA_STAND_URL
  }
  for (const name of ['LLM_RUNNER', 'LLM_RUNNER_CLAUDE', 'LLM_RUNNER_CODEX', 'BROWSER_RUNNER', 'TTS_RUNNER', 'STT_RUNNER'])
    result[`VC_${name}_URL`] ??= provided.SISLEXA_STAND_URL
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'apps/server/src/index.ts'], {
    stdio: 'inherit', env: componentEnvironment(process.env)
  })
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) process.once(signal, () => child.kill(signal))
  child.once('exit', code => { process.exitCode = code ?? 1 })
  child.once('error', error => { console.error(error); process.exitCode = 1 })
}
