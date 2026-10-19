import { chmod, lstat, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const componentIds = ['core', 'core-ui', 'make', 'kanban', 'playwright-reader', 'image-studio']
const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)
const terminal = new Set(['succeeded', 'failed', 'uncertain'])
const help = `Usage: node scripts/dev-stand.mjs start|status|stop --config FILE --journal FILE [--watch]
Start attaches a live working copy through the existing Core/Kanban API.
Stop restores the previous component. Use a NEW journal for each mutation.
Status only reads the recorded operation and stand; it never retries a mutation.
Config: {coreUrl, tokenFile, projectId, standId, component, workingCopyPath}
Both configuration and token files must be private. No gate, release or Docker build
is required to start a preview. Run gate:task separately in the working copy.`

async function privateJson(path) { return JSON.parse(await privateText(path)) }
async function privateText(path) {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw Error('private_file_required')
  return readFile(path, 'utf8')
}
export function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_config')
  const fields = ['coreUrl', 'tokenFile', 'projectId', 'standId', 'component', 'workingCopyPath']
  if (Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => typeof value[key] !== 'string')) throw Error('invalid_config')
  const url = new URL(value.coreUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw Error('invalid_core_url')
  if (!id(value.projectId) || !id(value.standId) || !componentIds.includes(value.component)
    || !isAbsolute(value.tokenFile) || !isAbsolute(value.workingCopyPath) || /[\x00-\x1f]/.test(value.workingCopyPath)) throw Error('invalid_config')
  return { ...value, coreUrl: url.origin }
}
async function replaceJournal(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}
async function request(config, token, suffix, method = 'GET', body) {
  const response = await fetch(`${config.coreUrl}/api/projects/${encodeURIComponent(config.projectId)}/dev-stands/${encodeURIComponent(config.standId)}${suffix}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  let value
  // Responses contain manifests/status only; never print an upstream response or exception.
  const text = await response.text()
  if (text.length > 1_048_576) throw Error('response_too_large')
  try { value = JSON.parse(text) } catch { throw Error('invalid_response') }
  if (!response.ok) {
    const error = Error(`http_${response.status}`)
    error.definitive = response.status >= 400 && response.status < 500
    error.status = response.status
    error.safeCode = typeof value?.error === 'string' && /^[a-z_]{1,80}$/.test(value.error) ? value.error : null
    throw error
  }
  return value
}
function checkJournal(value, config) {
  if (!value || value.version !== 1 || !['start', 'stop'].includes(value.action)
    || !['requesting', 'running', 'succeeded', 'failed', 'uncertain'].includes(value.state)
    || JSON.stringify(value.target) !== JSON.stringify(config)
    || (value.operationId !== null && !id(value.operationId))) throw Error('journal_target_mismatch')
  return value
}
export async function mutate(action, config, journalPath, token, call = request) {
  if (!['start', 'stop'].includes(action)) throw Error('invalid_action')
  const value = { version: 1, action, target: config, state: 'requesting', operationId: null, startedAt: Date.now() }
  // Exclusive creation is the replay fence, including after a lost response.
  await writeFile(journalPath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  await chmod(journalPath, 0o600)
  try {
    const result = await call(config, token, `/components/${encodeURIComponent(config.component)}/live`, action === 'start' ? 'POST' : 'DELETE', action === 'start' ? { workingCopyPath: config.workingCopyPath } : undefined)
    if (result?.standId !== config.standId || !id(result.operationId)) throw Error('invalid_receipt')
    value.operationId = result.operationId
    value.state = 'running'
  } catch (error) {
    value.state = error.definitive ? 'failed' : 'uncertain'
    value.error = error.safeCode ?? (error.definitive ? `http_${error.status}` : 'request_outcome_unknown')
  }
  await replaceJournal(journalPath, value)
  return publicResult(value)
}
function publicResult(value, stand) {
  const live = stand?.live?.find(entry => entry.component === value.target.component)
  const sha = live ? live.head : stand?.components?.[value.target.component]?.sha
  return {
    action: value.action, standId: value.target.standId, component: value.target.component,
    operationId: value.operationId, state: value.state, elapsedSeconds: Math.round(((value.finishedAt ?? Date.now()) - value.startedAt) / 1000),
    ...(value.error ? { error: value.error } : {}),
    ...(stand ? { standStatus: stand.status ?? 'unknown', gatewayHealth: stand.gateway?.health ?? 'unknown',
      urls: (stand.gateway?.urls ?? []).filter(url => { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash } catch { return false } }),
      live: !!live,
      sha: /^[a-f0-9]{40}$/.test(sha) ? sha : null } : {})
  }
}
export async function observe(config, journalPath, token, call = request) {
  const value = checkJournal(await privateJson(journalPath), config)
  if (value.state === 'requesting') {
    value.state = 'uncertain'
    value.error = 'request_outcome_unknown'
    await replaceJournal(journalPath, value)
  }
  if (value.operationId && !terminal.has(value.state)) {
    let rows
    try { rows = await call(config, token, '/operations') }
    catch { return { ...publicResult(value), observationError: 'operations_unavailable' } }
    if (!Array.isArray(rows)) throw Error('invalid_operation_list')
    const operation = rows.find(row => row.id === value.operationId)
    if (operation && ['succeeded', 'failed'].includes(operation.status)) {
      value.state = operation.status
      value.finishedAt = Number.isFinite(operation.finishedAt) && operation.finishedAt >= value.startedAt ? operation.finishedAt : Date.now()
      if (operation.status === 'failed') value.error = /^[a-z_]{1,80}$/.test(operation.error) ? operation.error : 'operation_failed'
      await replaceJournal(journalPath, value)
    }
  }
  let stand
  try { stand = await call(config, token, '') }
  catch { return { ...publicResult(value), observationError: 'stand_unavailable' } }
  if (stand?.standId !== config.standId) throw Error('invalid_stand')
  return publicResult(value, stand)
}
export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) { console.log(help); return }
  const [action, ...rest] = args
  const flags = new Map()
  for (let at = 0; at < rest.length; at++) {
    const key = rest[at]
    if (!['--config', '--journal', '--watch'].includes(key) || flags.has(key)) throw Error('invalid_arguments')
    const value = key === '--watch' ? true : rest[++at]
    if (!value || (typeof value === 'string' && value.startsWith('--'))) throw Error('invalid_arguments')
    flags.set(key, value)
  }
  if (!['start', 'status', 'stop'].includes(action) || !flags.get('--config') || !flags.get('--journal')) throw Error('invalid_arguments')
  const config = validateConfig(await privateJson(resolve(flags.get('--config'))))
  const token = (await privateText(config.tokenFile)).trim()
  if (!token || /\s/.test(token)) throw Error('invalid_token_file')
  const journal = resolve(flags.get('--journal'))
  let result = action === 'status' ? await observe(config, journal, token) : await mutate(action, config, journal, token)
  console.log(JSON.stringify(result))
  const deadline = Date.now() + 600_000
  while (flags.has('--watch') && !terminal.has(result.state) && Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 2000))
    const next = await observe(config, journal, token)
    if (next.state !== result.state || next.observationError !== result.observationError || Math.floor(next.elapsedSeconds / 10) !== Math.floor(result.elapsedSeconds / 10)) console.log(JSON.stringify(next))
    result = next
  }
  if (['failed', 'uncertain'].includes(result.state)) process.exitCode = 1
  else if (result.observationError || (flags.has('--watch') && !terminal.has(result.state))) process.exitCode = 2
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(JSON.stringify({ error: error.code === 'EEXIST' ? 'journal_already_exists_use_status' : ['invalid_arguments', 'private_file_required', 'invalid_config', 'invalid_core_url', 'invalid_token_file', 'journal_target_mismatch'].includes(error.message) ? error.message : 'dev_stand_request_failed' })); process.exitCode = 1 })
}
