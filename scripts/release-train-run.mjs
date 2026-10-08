// @ts-check
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, renameSync, rmSync, openSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { planReleaseTrain, nextPatch, pinnedRelease } from './release-train.mjs'

const json = path => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
export function redact(value, env = process.env, secrets = []) {
  let text = String(value)
  for (const secret of [...Object.entries(env).filter(([key]) => /token|secret|password|credential|api_key/i.test(key)).map(([, value]) => value), ...secrets]) {
    if (secret) text = text.replaceAll(secret, '[redacted]')
  }
  return text.replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/((?:token|password|secret|api_key)["']?\s*[:=]\s*["']?)[^\s,"']+/gi, '$1[redacted]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@')
}

export function requireDependencies(repository) {
  if (!existsSync(join(repository, 'node_modules/.bin/tsx'))) throw Error('Core checkout dependencies missing: node_modules/.bin/tsx; install dependencies in the Core checkout before running the release train')
}

export function execute(binary, args, cwd, options = {}) {
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeout ?? 3600000, env: { ...process.env, ...options.env }, input: options.input })
  if (result.error || result.status !== 0) {
    const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trimEnd().split(/\r?\n/).slice(-40).join('\n')
    throw Error(redact(`${[binary, ...args].join(' ')} failed (exit code ${result.status ?? 'unavailable'}${result.signal ? `, signal ${result.signal}` : ''})\n${output}`,
      { ...process.env, ...options.env }, [options.input?.trim()]))
  }
  return result.stdout.trim()
}

export function parseRunArgs(args) {
  const options = { apps: [], deploy: false, resume: undefined }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--deploy') options.deploy = true
    else if (['--apps', '--resume'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('-')) {
      const flag = args[i++], value = args[i]
      if (flag === '--apps') options.apps = value.split(',')
      else options.resume = value
    } else throw Error('Usage: release-train.mjs run [--apps a,b] [--deploy] | run --resume <id>')
  }
  if (options.resume && (options.deploy || options.apps.length)) throw Error('Resume uses the journal selection and deploy intent')
  if (options.resume && !/^[a-zA-Z0-9-]+$/.test(options.resume)) throw Error('Invalid journal id')
  return options
}

/** Knowledge topics (`<kbDir>/*.md` frontmatter `areas`) that cover any of the given repository files. */
export function topicsCoveringFiles(kbDir, files) {
  if (!existsSync(kbDir)) return []
  const covers = (area, file) => area === file || file.startsWith(area.replace(/\/+$/, '') + '/')
  return readdirSync(kbDir).filter(name => name.endsWith('.md') && name !== 'README.md').sort().filter(name => {
    const text = readFileSync(join(kbDir, name), 'utf8'), front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
    const areas = /(?:^|\n)areas:\n((?:[ \t]+- .*\n?)*)/.exec(front)?.[1] ?? ''
    return areas.split('\n').map(line => line.replace(/^[ \t]+- /, '').trim()).filter(Boolean).some(area => files.some(file => covers(area, file)))
  })
}

export function createJournal(plan, options, repository) {
  for (const app of options.apps) if (!plan.applications.some(row => row.application === app)) throw Error(`Unknown app: ${app}`)
  const selected = plan.applications.filter(row => !options.apps.length || options.apps.includes(row.application))
  // With --apps only the selected owners must be releasable: blockers of unrelated owners
  // (for example a stale pin of an application that is not released) do not stop the train.
  const selectedRepositories = new Set(selected.map(row => row.repository))
  const ready = options.apps.length
    ? Object.values(plan.prerequisites ?? {}).every(check => check.ok) && Boolean(plan.core)
      && !plan.applications.some(row => selectedRepositories.has(row.repository) && row.error)
    : plan.ready
  if (!ready) throw Error('Release plan blocked; run plan --json for prerequisites')
  const owners = []
  for (const row of selected) {
    if (owners.some(owner => owner.repository === row.repository)) continue
    if (!row.changes.ahead && row.release.matchesPinnedCommit) continue
    owners.push({ repository: row.repository, version: row.changes.ahead ? row.proposedVersion : row.pinnedVersion,
      source: row.changes.ahead ? row.changes.dev : row.pinnedCommit, main: row.changes.main, bump: row.changes.ahead,
      applications: plan.applications.filter(app => app.repository === row.repository).map(app => app.application) })
  }
  return { schemaVersion: 1, id: randomUUID(), repository: resolve(repository), deploy: options.deploy,
    core: plan.core, owners, results: {}, status: 'running', pending: null }
}

// Atomic checkpoints plus an exclusive process lock. In-flight operations must reconcile
// their external result before retrying (PRs, pushes, release branches and deployments).
export async function executeJournal(journal, directory, adapter) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, `${journal.id}.json`), lock = `${file}.lock`
  const fd = openSync(lock, 'wx', 0o600)
  const save = () => { write(`${file}.tmp`, journal); renameSync(`${file}.tmp`, file) }
  try {
    save()
    const steps = journal.owners.flatMap((owner, index) =>
      (owner.bump ? ['prepare', 'gate', 'merge', 'sync', 'publish', 'verify'] : ['publish', 'verify'])
        .map(action => ({ key: `owner-${index}-${action}`, action, owner })))
    if (journal.owners.length || journal.core.count) steps.push(...['pin', 'coreGate', 'coreMerge', 'preflight', 'branch',
      ...(journal.deploy ? ['deploy', 'health'] : [])].map(action => ({ key: action, action, owner: null })))
    for (const step of steps) {
      if (Object.hasOwn(journal.results, step.key)) continue
      journal.pending = step.key; journal.status = 'running'; save()
      try { journal.results[step.key] = await adapter(step.action, step.owner, journal) ?? null }
      catch (error) {
        journal.status = 'failed'; journal.error = redact(error.message); save()
        throw Error(`Release train ${journal.id} stopped at ${step.key}; run --resume ${journal.id}\n${journal.error}`)
      }
      delete journal.error
      journal.pending = null; save()
    }
    journal.status = 'completed'; save()
    return journal
  } finally { closeSync(fd); rmSync(lock, { force: true }) }
}

export function concreteAdapter({ repository, directory, env = process.env, run = execute, fetcher = fetch,
  sleep = ms => new Promise(done => setTimeout(done, ms)), now = Date.now }) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN
  let deadline = Infinity
  const remaining = () => {
    if (now() >= deadline) throw Error('Verification deadline reached')
    return Math.max(1, Math.min(30000, deadline - now()))
  }
  const request = async (base, path, method = 'GET', body = undefined, secret = token) => {
    const github = base === 'https://api.github.com'
    for (let attempt = 0; ; attempt++) {
      let response, data, failure
      try {
        response = await fetcher(`${base}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(remaining()),
          headers: { Authorization: `Bearer ${secret}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
        data = await response.json()
      } catch (error) { failure = error }
      if (response?.ok && !failure) return data
      const status = response?.status
      const message = redact(`${github ? 'GitHub' : 'Release API'} HTTP ${status ?? 'unavailable'}: ${data?.message ?? failure?.message ?? 'Request failed'}${data?.errors ? `; errors: ${JSON.stringify(data.errors)}` : ''}`, env)
      if (!github || attempt >= 5 || (status !== undefined && status !== 422 && status < 500) || now() >= deadline)
        throw Object.assign(Error(message), { status })
      await sleep(Math.min(1000 * 2 ** attempt, Math.max(0, deadline - now())))
      if (now() >= deadline) throw Object.assign(Error(message), { status })
    }
  }
  const gh = (path, method = 'GET', body = undefined) => request('https://api.github.com', path, method, body)
  const get = async (path, optional = false) => {
    try { return await gh(path) } catch (error) { if (optional && error.status === 404) return null; throw error }
  }
  const rc = (path, method = 'GET', body = undefined) => request(env.RELEASE_CENTER_URL,
    `/api/projects/${encodeURIComponent(env.RELEASE_CENTER_PROJECT_ID)}/releases${path}`, method, body, env.RELEASE_CENTER_TOKEN)
  const git = (cwd, ...args) => run('git', args, cwd)
  const clone = (remote, source, cwd) => {
    if (!existsSync(join(cwd, '.git'))) {
      // An interrupted clone is disposable; only train-owned directories are passed here.
      rmSync(cwd, { recursive: true, force: true })
      run('git', ['clone', '--no-checkout', '--', remote, cwd], directory)
      git(cwd, 'checkout', '--detach', source)
      return
    }
    git(cwd, 'fetch', 'origin')
    if (!git(cwd, 'status', '--porcelain')) git(cwd, 'checkout', '--detach', source)
  }
  const merge = async (slug, head, expected, baseline) => {
    const prefix = `/repos/${slug}`
    const prs = await gh(`${prefix}/pulls?state=all&head=${encodeURIComponent(slug.split('/')[0] + ':' + head)}&base=main`)
    let pr = prs.find(row => row.head.sha === expected && row.base.ref === 'main')
    if (!pr) pr = await gh(`${prefix}/pulls`, 'POST', { title: `Release ${head}`, head, base: 'main', body: 'Release train: owner gate passed.' })
    const detail = await gh(`${prefix}/pulls/${pr.number}`)
    if (detail.merged) return detail.merge_commit_sha
    if (baseline && (await gh(`${prefix}/commits/main`)).sha !== baseline) throw Error('Main changed after planning; replan before merging')
    const result = await gh(`${prefix}/pulls/${pr.number}/merge`, 'PUT', { sha: expected, merge_method: 'merge' })
    if (!result.merged) throw Error('PR merge rejected; required review/checks must pass')
    return result.sha
  }
  const withDocker = async callback => {
    const config = mkdtempSync(join(directory, 'docker-'))
    try {
      const user = await gh('/user')
      const options = { env: { ...env, DOCKER_CONFIG: config, GITHUB_TOKEN: token } }
      run('docker', ['login', 'ghcr.io', '--username', user.login, '--password-stdin'], repository, { ...options, input: token + '\n', timeout: remaining() })
      return await callback(options)
    } finally { rmSync(config, { recursive: true, force: true }) }
  }
  const adapter = async (action, owner, journal) => {
    const workspace = join(directory, journal.id); mkdirSync(workspace, { recursive: true })
    const index = owner ? journal.owners.indexOf(owner) : -1
    const cwd = join(workspace, owner ? `owner-${index}` : 'core')
    const result = name => journal.results[`owner-${index}-${name}`]
    const lock = json(join(repository, 'deploy/tools.lock.json'))
    if (action === 'prepare') {
      clone(`https://github.com/${owner.repository}.git`, owner.source, cwd)
      const files = [...new Set(['package.json', ...owner.applications.map(app => join(lock.tools[app].workspace, 'package.json'))])]
      for (const file of files) { const pkg = json(join(cwd, file)); pkg.version = owner.version; write(join(cwd, file), pkg) }
      const pkg = json(join(cwd, 'package.json')), kb = Boolean(pkg.scripts?.['kb:check'])
      // Topics must be fresh before the bump; afterwards only topics whose areas cover the bumped
      // manifests are re-checked, because a version-only commit does not change their content.
      if (kb) { run('npm', ['ci', '--ignore-scripts'], cwd); run('npm', ['run', 'kb:check'], cwd) }
      run('npm', ['install', '--package-lock-only'], cwd)
      git(cwd, 'add', '--', ...files, 'package-lock.json')
      if (git(cwd, 'diff', '--cached', '--name-only')) git(cwd, 'commit', '-m', `Release ${owner.version}`)
      if (kb) {
        const kbDir = join(cwd, existsSync(join(cwd, 'kb.config.json')) ? json(join(cwd, 'kb.config.json')).kbDir ?? 'docs/kb' : 'docs/kb')
        const topics = topicsCoveringFiles(kbDir, [...files, 'package-lock.json'])
        const touch = existsSync(join(cwd, 'scripts/kb.mjs')) ? ['node', ['scripts/kb.mjs', 'touch']] : ['npx', ['--no-install', 'sislexa-kb', 'touch']]
        for (const topic of topics) run(touch[0], [...touch[1], topic], cwd)
        if (topics.length) {
          if (pkg.scripts['kb:index']) run('npm', ['run', 'kb:index'], cwd)
          git(cwd, 'add', '--all', '--', relative(cwd, kbDir))
          // A separate commit: touch records the current HEAD, which an amend would orphan.
          git(cwd, 'commit', '-m', `docs(kb): reconcile topics after release ${owner.version}`)
        }
        run('npm', ['run', 'kb:check'], cwd)
      }
      return git(cwd, 'rev-parse', 'HEAD')
    }
    if (action === 'gate') {
      run('npm', ['ci'], cwd)
      const pkg = json(join(cwd, 'package.json'))
      if (!pkg.scripts?.gate) throw Error('Owner full gate missing')
      run('npm', ['run', pkg.scripts['gate:release'] ? 'gate:release' : 'gate'], cwd)
      if (git(cwd, 'status', '--porcelain') || git(cwd, 'rev-parse', 'HEAD') !== result('prepare')) throw Error('Gate changed release inputs')
    }
    if (action === 'merge') {
      const branch = `release/${owner.version}`
      git(cwd, 'push', 'origin', `${result('prepare')}:refs/heads/${branch}`)
      return merge(owner.repository, branch, result('prepare'), owner.main)
    }
    if (action === 'sync') {
      git(cwd, 'fetch', 'origin')
      git(cwd, 'merge-base', '--is-ancestor', 'origin/dev', result('merge'))
      git(cwd, 'push', 'origin', `${result('merge')}:refs/heads/dev`)
    }
    if (action === 'publish') {
      const source = join(workspace, `publish-${index}`), commit = result('merge') ?? owner.source
      // Rebuild a disposable clean clone on retries; publication reconciles existing tags.
      rmSync(source, { recursive: true, force: true })
      clone(`https://github.com/${owner.repository}.git`, commit, source)
      run('npm', ['ci'], source)
      await withDocker(options => run(process.execPath,
        ['--import', 'tsx', join(repository, 'scripts/owner-release-publish.mjs'), '--source', source], repository, options))
      return commit
    }
    if (action === 'verify') {
      deadline = now() + 300000
      try {
        for (;;) {
          try { return await verify() } catch (error) {
            if (now() >= deadline) throw Error(`Release verification timed out after 5 minutes: ${redact(error.message, env)}`)
            await sleep(Math.min(5000, deadline - now()))
            if (now() >= deadline) throw Error(`Release verification timed out after 5 minutes: ${redact(error.message, env)}`)
          }
        }
      } finally { deadline = Infinity }
      async function verify() {
        const commit = result('publish')
        if (!(await pinnedRelease(owner.repository, owner.version, commit, get)).matchesPinnedCommit) throw Error('Published release mismatch')
        const release = await get(`/repos/${owner.repository}/releases/tags/v${owner.version}`)
        const asset = release.assets.find(row => row.name === 'sislexa-release.json')
        if (!asset) throw Error('Release manifest missing')
        if (!asset.url.startsWith('https://api.github.com/')) throw Error('Untrusted release asset URL')
        let response = await fetcher(asset.url, { redirect: 'manual', signal: AbortSignal.timeout(remaining()), headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' } })
        if (response.status === 302) {
          const url = new URL(response.headers.get('location'))
          if (url.protocol !== 'https:' || !url.hostname.endsWith('.githubusercontent.com')) throw Error('Untrusted release asset redirect')
          response = await fetcher(url.href, { redirect: 'error', signal: AbortSignal.timeout(remaining()) })
        }
        if (!response.ok) throw Error('Manifest download failed')
        const manifest = await response.json()
        if (manifest.commit !== commit || manifest.version !== owner.version || manifest.repository !== `https://github.com/${owner.repository}`) throw Error('Manifest provenance mismatch')
        const { OWNER_IMAGES } = await import('./owner-release-publish.mjs')
        const expected = OWNER_IMAGES[manifest.repository] ?? []
        for (const image of expected) if (!manifest.images.some(row => row.name === image.name)) throw Error('Manifest image missing')
        await withDocker(options => { for (const image of expected) run('docker', ['manifest', 'inspect', `${image.name}:${commit}`], repository, { ...options, timeout: remaining() }) })
        return { commit, version: owner.version, images: expected.map(image => image.name) }
      }
    }
    if (action === 'pin') {
      clone(git(repository, 'remote', 'get-url', 'origin'), journal.core.dev, cwd)
      const pins = json(join(cwd, 'deploy/tools.lock.json'))
      let compose = readFileSync(join(cwd, 'docker-compose.yml'), 'utf8')
      let doc = readFileSync(join(cwd, 'docs/kb/deploy.md'), 'utf8')
      for (const [i, row] of journal.owners.entries()) {
        const verified = journal.results[`owner-${i}-verify`]
        for (const app of row.applications) {
          const pin = pins.tools[app]
          doc = doc.replaceAll(pin.commit, verified.commit)
          pin.version = verified.version; pin.commit = verified.commit
        }
        for (const image of verified.images) {
          const escaped = image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          compose = compose.replace(new RegExp(`${escaped}:[a-f0-9]{40}`, 'g'), `${image}:${verified.commit}`)
        }
      }
      const marker = `<!-- release-train:${journal.id} -->`
      if (!doc.includes(marker)) doc += `\n${marker}\n` + journal.owners.map(row => `- ${row.repository}: ${row.version}\n`).join('')
      write(join(cwd, 'deploy/tools.lock.json'), pins)
      writeFileSync(join(cwd, 'docker-compose.yml'), compose); writeFileSync(join(cwd, 'docs/kb/deploy.md'), doc)
      run(process.execPath, ['scripts/kb.mjs', 'touch', 'docs/kb/deploy.md'], cwd)
      run('npm', ['run', 'kb:log', '--', `release-train-${journal.id}`], cwd)
      run('npm', ['run', 'kb:index'], cwd)
      git(cwd, 'add', '--', 'deploy/tools.lock.json', 'docker-compose.yml', 'docs')
      if (git(cwd, 'diff', '--cached', '--name-only')) git(cwd, 'commit', '-m', `Pin release train ${journal.id}`)
      return git(cwd, 'rev-parse', 'HEAD')
    }
    if (action === 'coreGate') {
      run('npm', ['ci'], cwd); run('npm', ['run', 'gate'], cwd)
      if (git(cwd, 'status', '--porcelain')) throw Error('Core gate changed release inputs')
    }
    if (action === 'coreMerge') {
      const coreGate = () => {
        run('npm', ['ci'], cwd); run('npm', ['run', 'gate'], cwd)
        if (git(cwd, 'status', '--porcelain')) throw Error('Core gate changed release inputs')
        journal.results.coreGate = null
      }
      if (!Object.hasOwn(journal.results, 'coreGate')) coreGate()
      try { git(cwd, 'push', 'origin', `${journal.results.pin}:refs/heads/dev`) }
      catch (error) {
        if (!/non-fast-forward|fetch first|stale info/i.test(error.message)) throw error
        git(cwd, 'fetch', 'origin')
        // Replay only the pin commit, preserving concurrent dev changes.
        try { git(cwd, 'rebase', '--onto', 'origin/dev', `${journal.results.pin}^`) }
        catch (rebaseError) {
          const conflicts = git(cwd, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean)
          if (conflicts.length !== 1 || conflicts[0] !== 'docs/kb/README.md') {
            git(cwd, 'rebase', '--abort'); throw rebaseError
          }
          try {
            git(cwd, 'checkout', '--ours', '--', 'docs/kb/README.md')
            run('npm', ['run', 'kb:index'], cwd)
            git(cwd, 'add', '--', 'docs/kb/README.md')
            run('git', ['-c', 'core.editor=true', 'rebase', '--continue'], cwd)
          } catch (resolutionError) { git(cwd, 'rebase', '--abort'); throw resolutionError }
        }
        journal.results.pin = git(cwd, 'rev-parse', 'HEAD')
        delete journal.results.coreGate
        coreGate()
        git(cwd, 'push', 'origin', `${journal.results.pin}:refs/heads/dev`)
      }
      const remote = git(cwd, 'remote', 'get-url', 'origin')
      const { githubRepository } = await import('./release-train.mjs')
      const slug = githubRepository(remote)
      if (!slug) throw Error('Core GitHub remote required')
      return merge(slug, 'dev', journal.results.pin, journal.core.main)
    }
    if (action === 'preflight') {
      const response = await rc('/preflight' + (env.RELEASE_CENTER_AGENT_ID ? `?agentId=${encodeURIComponent(env.RELEASE_CENTER_AGENT_ID)}` : ''))
      if (response.ok !== true) throw Error('Release Center preflight blocked')
      const rows = await rc('/branches')
      const branches = Array.isArray(rows) ? rows : rows.branches
      const versions = branches.map(row => row.version).filter(version => /^\d+\.\d+\.\d+$/.test(version))
      versions.sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] })
      return { version: nextPatch(versions.at(-1) ?? json(join(cwd, 'package.json')).version) }
    }
    const version = journal.results.preflight?.version, branch = `release/${version}`
    if (action === 'branch') {
      const rows = await rc('/branches'), branches = Array.isArray(rows) ? rows : rows.branches
      const existing = branches.find(row => row.branch === branch)
      if (existing) {
        if (existing.sha !== journal.results.coreMerge) throw Error('Core release branch provenance mismatch')
        return existing
      }
      const check = await rc('/preflight' + (env.RELEASE_CENTER_AGENT_ID ? `?agentId=${encodeURIComponent(env.RELEASE_CENTER_AGENT_ID)}` : ''))
      if (check.ok !== true) throw Error('Release Center preflight blocked')
      const { githubRepository } = await import('./release-train.mjs')
      const slug = githubRepository(git(cwd, 'remote', 'get-url', 'origin'))
      if ((await gh(`/repos/${slug}/commits/main`)).sha !== journal.results.coreMerge) throw Error('Core main moved after gate')
      return rc('/branches', 'POST', { branch, baseBranch: 'main', ...(env.RELEASE_CENTER_AGENT_ID ? { agentId: env.RELEASE_CENTER_AGENT_ID } : {}) })
    }
    if (action === 'deploy') {
      const rows = await rc(''), releases = Array.isArray(rows) ? rows : rows.releases
      const existing = releases.find(row => row.branch === branch)
      if (existing) return existing
      return rc('/deploy', 'POST', { branch })
    }
    if (action === 'health') {
      for (let attempt = 0; attempt < 120; attempt++) {
        const release = await rc(`/${encodeURIComponent(journal.results.deploy.id)}`)
        if (['failed', 'cancelled'].includes(release.status)) throw Error('Core deployment failed')
        try {
          const response = await fetcher(`${env.RELEASE_HEALTH_URL}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(10000) })
          if (response.ok && (await response.json()).version === version) return { version }
        } catch {}
        await new Promise(done => setTimeout(done, 5000))
      }
      throw Error('Timed out waiting for new Core version')
    }
  }
  return async (...args) => {
    try { return await adapter(...args) } catch (error) { throw Error(redact(error.message, env)) }
  }
}

export async function runCli(args, env = process.env) {
  const options = parseRunArgs(args), repository = resolve(import.meta.dirname, '..')
  requireDependencies(repository)
  const directory = join(homedir(), '.local/state/sislexa/release-train')
  for (const name of ['RELEASE_CENTER_URL', 'RELEASE_CENTER_PROJECT_ID', 'RELEASE_CENTER_TOKEN']) if (!env[name]) throw Error(`${name} required`)
  if (!(env.GH_TOKEN || env.GITHUB_TOKEN)) throw Error('GitHub token required')
  let journal
  if (options.resume) journal = json(join(directory, `${options.resume}.json`))
  else journal = createJournal(await planReleaseTrain({ repository, env }), options, repository)
  if (journal.schemaVersion !== 1 || journal.repository !== repository || (options.resume && journal.id !== options.resume)) throw Error('Journal does not belong to this checkout')
  const target = { url: env.RELEASE_CENTER_URL, project: env.RELEASE_CENTER_PROJECT_ID,
    agent: env.RELEASE_CENTER_AGENT_ID ?? null, health: env.RELEASE_HEALTH_URL ?? null }
  if (options.resume && JSON.stringify(journal.target) !== JSON.stringify(target)) throw Error('Release Center target changed; restore the original environment before resuming')
  journal.target = target
  if (journal.deploy && !env.RELEASE_HEALTH_URL) throw Error('RELEASE_HEALTH_URL required for deployment')
  await executeJournal(journal, directory, concreteAdapter({ repository, directory, env }))
  console.log(`Release train ${journal.id}: completed`)
}
