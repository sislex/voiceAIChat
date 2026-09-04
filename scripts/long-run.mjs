import { open, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants as osConstants } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = 1
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runsDir = (env = process.env) => resolve(env.VC_LONG_RUN_DIR || join(rootDir, '.long-runs'))
const pathsFor = (runId, env = process.env) => ({
  runId,
  logPath: join(runsDir(env), `${runId}.log`),
  statusPath: join(runsDir(env), `${runId}.json`)
})

async function writeStatus(path, status) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

function statusError(message) {
  return Object.assign(new Error(message), { code: 'LONG_RUN_STATUS' })
}

async function loadStatus(runId, env = process.env) {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw statusError(`invalid runId: ${runId}`)
  const paths = pathsFor(runId, env)
  let text
  try {
    text = await readFile(paths.statusPath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') throw statusError(`unknown runId: ${runId}`)
    throw error
  }
  let status
  try {
    status = JSON.parse(text)
  } catch {
    throw statusError(`malformed status for runId: ${runId}`)
  }
  const validTerminal = status.state !== 'finished' || Number.isInteger(status.exitCode) && typeof status.finishedAt === 'string'
  if (status.version !== VERSION || status.runId !== runId || !Number.isInteger(status.pid) || !Array.isArray(status.command) || !['running', 'finished'].includes(status.state) || !validTerminal) {
    throw statusError(`invalid status for runId: ${runId}`)
  }
  return { status, paths }
}

export function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

export async function getRunStatus(runId, env = process.env) {
  const { status, paths } = await loadStatus(runId, env)
  if (status.state === 'finished') {
    return { ...status, state: status.exitCode === 0 ? 'succeeded' : 'failed', ...paths }
  }
  return { ...status, state: processExists(status.pid) ? 'running' : 'lost', ...paths }
}

export async function startRun(command, env = process.env) {
  if (!Array.isArray(command) || command.length === 0 || !command[0]) throw new Error('usage: long-run start -- <command> [args...]')
  await mkdir(runsDir(env), { recursive: true })
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID()}`
  const paths = pathsFor(runId, env)
  const log = await open(paths.logPath, 'wx')
  await log.close()

  const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), 'worker', runId, JSON.stringify(command)], {
    cwd: rootDir,
    detached: true,
    env,
    stdio: 'ignore'
  })
  if (!worker.pid) throw new Error('failed to start long-run worker')
  const initial = { version: VERSION, runId, pid: worker.pid, startedAt: new Date().toISOString(), command, state: 'running' }
  try {
    await writeStatus(paths.statusPath, initial)
  } catch (error) {
    try { process.kill(worker.pid, 'SIGTERM') } catch {}
    throw error
  }
  worker.unref()
  return { ...initial, ...paths }
}

function normalizedExitCode(code, signal) {
  if (Number.isInteger(code)) return code
  const number = signal && osConstants.signals[signal]
  return Number.isInteger(number) ? 128 + number : 1
}

async function runWorker(runId, encodedCommand, env = process.env) {
  const paths = pathsFor(runId, env)
  const command = JSON.parse(encodedCommand)
  let initial
  for (let attempts = 0; attempts < 200; attempts += 1) {
    try {
      initial = (await loadStatus(runId, env)).status
      break
    } catch (error) {
      if (!String(error.message).startsWith('unknown runId:')) throw error
      await new Promise((done) => setTimeout(done, 10))
    }
  }
  if (!initial) throw new Error(`initial status was not created for ${runId}`)

  const log = await open(paths.logPath, 'a')
  let code = 1
  let signal = null
  try {
    const child = spawn(command[0], command.slice(1), { cwd: rootDir, env, shell: false, stdio: ['ignore', log.fd, log.fd] })
    ;({ code, signal } = await new Promise((done, reject) => {
      child.once('error', reject)
      child.once('exit', (exitCode, exitSignal) => done({ code: exitCode, signal: exitSignal }))
    }))
  } catch (error) {
    await log.write(`[long-run] spawn failed: ${error.stack || error.message}\n`)
  } finally {
    await log.close()
  }
  await writeStatus(paths.statusPath, {
    ...initial,
    state: 'finished',
    finishedAt: new Date().toISOString(),
    exitCode: normalizedExitCode(code, signal),
    signal: signal || null
  })
}

async function main() {
  const [action, ...args] = process.argv.slice(2)
  if (action === 'start') {
    console.log(JSON.stringify(await startRun(args.slice(args[0] === '--' ? 1 : 0))))
  } else if (action === 'status') {
    if (args.length !== 1) throw new Error('usage: long-run status <runId>')
    console.log(JSON.stringify(await getRunStatus(args[0])))
  } else if (action === 'worker') {
    if (args.length !== 2) throw new Error('invalid worker invocation')
    await runWorker(args[0], args[1])
  } else {
    throw new Error('usage: long-run <start|status> ...')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[long-run] ${error.message}`)
    process.exitCode = 1
  })
}
