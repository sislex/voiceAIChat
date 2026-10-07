// @ts-check
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function command(binary, args, cwd = root) {
  const result = spawnSync(binary, args, {
    cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  })
  // Stderr can contain private URLs or credentials.
  if (result.error || result.status !== 0) throw Error(`${binary} read-only check failed`)
  return result.stdout.trim()
}

export function githubRepository(value) {
  if (typeof value !== 'string') return null
  return /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(value)?.[1] ?? null
}

export function nextPatch(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw Error('Invalid pinned patch version')
  const [major, minor, patch] = version.split('.')
  return `${major}.${minor}.${BigInt(patch) + 1n}`
}

export function githubClient(token, fetcher = fetch) {
  return async function get(path, optional = false) {
    let response
    try {
      response = await fetcher(`https://api.github.com${path}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }
      })
    } catch { throw Error('GitHub request failed') }
    if (optional && response.status === 404) return null
    if (!response.ok) throw Error(`GitHub HTTP ${response.status}`)
    try { return await response.json() } catch { throw Error('Invalid GitHub response') }
  }
}

export async function ownerChanges(repository, get) {
  // Pin both heads so pagination cannot mix moving branch snapshots.
  const main = await get(`/repos/${repository}/commits/main`)
  const dev = await get(`/repos/${repository}/commits/dev`)
  const commits = []
  let total = 0, status = ''
  for (let page = 1; ; page++) {
    const comparison = await get(`/repos/${repository}/compare/${main.sha}...${dev.sha}?per_page=100&page=${page}`)
    if (page === 1) { total = comparison.ahead_by; status = comparison.status }
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(comparison.commits)) throw Error('Invalid GitHub comparison')
    commits.push(...comparison.commits.map(commit => ({ commit: commit.sha, subject: commit.commit.message.split('\n')[0] })))
    if (commits.length >= total) break
    if (!comparison.commits.length) throw Error('Incomplete GitHub comparison')
  }
  if (commits.length !== total) throw Error('Inconsistent GitHub comparison')
  return { main: main.sha, dev: dev.sha, status, ahead: total > 0, count: total, commits }
}

export async function pinnedRelease(repository, version, commit, get) {
  const tag = `v${version}`
  const release = await get(`/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, true)
  if (!release) return { tag, published: false, commit: null, matchesPinnedCommit: false }
  // target_commitish can be a moving branch. Resolve the actual tag, including annotated tags.
  const target = await get(`/repos/${repository}/commits/${encodeURIComponent(tag)}`)
  const published = !release.draft && Boolean(release.published_at)
  return { tag, published, commit: target.sha, matchesPinnedCommit: published && target.sha.toLowerCase() === commit.toLowerCase() }
}

export function protectedWorktrees(directory, run = command) {
  try {
    if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== resolve(directory)) throw Error('Unsafe root')
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw Error('Unexpected root entry')
      const cwd = join(directory, entry.name)
      if (realpathSync(run('git', ['rev-parse', '--show-toplevel'], cwd)) !== realpathSync(cwd)) throw Error('Not a worktree')
      if (run('git', ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'], cwd)) throw Error('Dirty worktree')
    }
    return { ok: true, detail: 'Protected root exists; all worktrees are clean' }
  } catch { return { ok: false, detail: 'Protected root missing, unreadable, unsafe or contains dirty/non-worktree entries' } }
}

export function coreChanges(repository = root, run = command) {
  const main = run('git', ['rev-parse', '--verify', 'origin/main^{commit}'], repository)
  const dev = run('git', ['rev-parse', '--verify', 'origin/dev^{commit}'], repository)
  const log = run('git', ['log', '--reverse', '--format=%H%x09%s', `${main}..${dev}`, '--'], repository)
  const commits = log ? log.split('\n').map(line => {
    const tab = line.indexOf('\t')
    return { commit: line.slice(0, tab), subject: line.slice(tab + 1) }
  }) : []
  return { range: 'origin/main..origin/dev', main, dev, count: commits.length, commits }
}

export async function planReleaseTrain({ repository = root, worktreeRoot = join(homedir(), 'sislexa-worktrees'), env = process.env, run = command, fetcher = fetch } = {}) {
  const token = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim()
  const prerequisites = {
    token: { ok: Boolean(token), detail: token ? 'GitHub token present' : 'GH_TOKEN or GITHUB_TOKEN required' },
    docker: { ok: false, detail: 'Docker daemon unreachable' },
    worktrees: protectedWorktrees(worktreeRoot, run)
  }
  try { run('docker', ['info', '--format', '{{.ServerVersion}}'], repository); prerequisites.docker = { ok: true, detail: 'Docker daemon reachable' } } catch {}
  const errors = [], applications = [], steps = []
  const lock = JSON.parse(readFileSync(join(repository, 'deploy/tools.lock.json'), 'utf8'))
  if (!lock.tools || typeof lock.tools !== 'object' || Array.isArray(lock.tools)) throw Error('Invalid tools lock')
  const get = githubClient(token ?? '', fetcher)
  const comparisons = new Map(), releases = new Map(), scheduled = new Set(), ownerPins = new Map()
  for (const [application, pin] of Object.entries(lock.tools)) {
    const owner = githubRepository(pin.repository)
    if (!owner) continue
    const item = { application, repository: owner, pinnedVersion: pin.version, pinnedCommit: pin.commit, proposedVersion: null, changes: null, release: null, error: null }
    try {
      item.proposedVersion = nextPatch(pin.version)
      if (!/^[a-f0-9]{40}$/i.test(pin.commit)) throw Error('Invalid pinned commit')
      const identity = `${pin.version}:${pin.commit}`
      if (ownerPins.has(owner) && ownerPins.get(owner) !== identity) throw Error('Applications sharing an owner repository have inconsistent pins')
      ownerPins.set(owner, identity)
      if (!token) throw Error('GitHub token required for owner inspection')
      if (!comparisons.has(owner)) comparisons.set(owner, await ownerChanges(owner, get))
      item.changes = comparisons.get(owner)
      const key = `${owner}@${pin.version}:${pin.commit}`
      if (!releases.has(key)) releases.set(key, await pinnedRelease(owner, pin.version, pin.commit, get))
      item.release = releases.get(key)
      if (item.changes.status === 'diverged') throw Error('Owner main and dev diverged; reconcile before release')
      if (item.release.published && !item.release.matchesPinnedCommit) throw Error('Published tag does not match pinned commit')
      if (item.changes.ahead && !scheduled.has(owner)) {
        scheduled.add(owner)
        steps.push(`${owner}: bump to ${item.proposedVersion}; run owner full gate; merge release/${item.proposedVersion} into main; sync dev; publish from clean clone; verify GitHub release and image`)
      } else if (!item.changes.ahead && !item.release.matchesPinnedCommit && !scheduled.has(owner)) {
        scheduled.add(owner)
        steps.push(`${owner}: publish pinned ${pin.version} at ${pin.commit} from clean clone; verify GitHub release and image`)
      }
    } catch (error) { item.error = error.message; errors.push(`${application}: ${error.message}`) }
    applications.push(item)
  }
  let core = null
  try { core = coreChanges(repository, run) } catch { errors.push('Core origin/main or origin/dev unavailable; refresh refs outside the planner') }
  if (steps.length) steps.push('Core: pin verified owner versions and images; update deploy KB and log/index')
  if (steps.length || core?.count) steps.push('Core: run full gate; merge dev into main; Release Center preflight; create Core release branch', 'Production deploy requires a separate explicit operator action')
  return { schemaVersion: 1, mode: 'plan', ready: Object.values(prerequisites).every(check => check.ok) && !errors.length, prerequisites, applications, core, steps, errors }
}

export function formatPlan(plan) {
  return ['Release train plan (read-only)', ...Object.entries(plan.prerequisites).map(([name, check]) => `${check.ok ? 'OK' : 'BLOCKED'} ${name}: ${check.detail}`),
    ...plan.applications.flatMap(app => [
      `${app.application} (${app.repository}): pinned ${app.pinnedVersion} @ ${app.pinnedCommit}; next patch ${app.proposedVersion ?? 'unknown'}`,
      `  dev ahead: ${app.changes ? `${app.changes.ahead} (${app.changes.count}; ${app.changes.status})` : 'unknown'}; published pinned release: ${app.release ? app.release.matchesPinnedCommit : 'unknown'}`,
      ...(app.changes?.commits ?? []).map(commit => `  ${commit.commit} ${commit.subject}`)
    ]), `Core origin/main..origin/dev: ${plan.core?.count ?? 'unknown'}`,
    ...(plan.core?.commits ?? []).map(commit => `  ${commit.commit} ${commit.subject}`),
    ...plan.errors.map(error => `BLOCKED: ${error}`),
    plan.ready ? 'Proposed order:' : 'Blocked; proposed order after resolving blockers:',
    ...plan.steps.map((step, index) => `${index + 1}. ${step}`), ...(plan.steps.length ? [] : ['No release actions identified.'])].join('\n')
}

export async function main(args = process.argv.slice(2)) {
  if (args[0] !== 'plan' || args.length > 2 || (args[1] && args[1] !== '--json')) throw Error('Usage: node scripts/release-train.mjs plan [--json]')
  const plan = await planReleaseTrain()
  console.log(args.includes('--json') ? JSON.stringify(plan, null, 2) : formatPlan(plan))
  if (!plan.ready) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Release train planning failed; check arguments, tools lock and read access'); process.exitCode = 1 })
}
