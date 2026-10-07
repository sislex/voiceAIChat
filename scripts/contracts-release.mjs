// Release local contract pins. Publishing and pushing are separate operations.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.error || result.status !== 0)
    throw Error(`${command} ${args.join(' ')}: ${result.error?.message ?? `exit ${result.status}`}\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  return result.stdout
}
const git = (cwd, ...args) => run('git', args, cwd).trim()

export function parseArgs(args) {
  const [name, ...rest] = args
  const options = { name }
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]
    if (!['--version', '--source', '--commit', '--consumers'].includes(flag) || !rest[i + 1] || rest[i + 1].startsWith('--') || options[flag.slice(2)])
      throw Error(`Invalid or repeated option: ${flag}`)
    options[flag.slice(2)] = rest[i + 1]
  }
  if (!(name === '@voicechat/shared' || /^@[\w.-]+\/[\w.-]+-contracts$/.test(name ?? '')))
    throw Error('Expected @voicechat/shared or an owner *-contracts package')
  if (!/^\d+\.\d+\.\d+$/.test(options.version ?? '') || !options.source || !/^[a-f0-9]{40}$/.test(options.commit ?? ''))
    throw Error('Expected --version x.y.z --source <owner-repo-path> --commit <full SHA>')
  return options
}

function manifests(root) {
  // Only tracked manifests belong to the checkout, excluding generated dependencies.
  return git(root, 'ls-files', '-z').split('\0')
    .filter(path => path === 'package.json' || path.endsWith('/package.json'))
    .filter(path => !path.split('/').some(part => ['node_modules', 'vendor', 'artifacts', 'dist'].includes(part)))
    .map(path => join(root, path))
}

function pin(root, archive, entry) {
  const vendor = join(root, 'vendor')
  mkdirSync(vendor, { recursive: true })
  const target = join(vendor, entry.asset)
  copyFileSync(archive, target)
  for (const path of manifests(root)) {
    const manifest = read(path)
    let changed = false
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      if (!Object.hasOwn(manifest[field] ?? {}, entry.name)) continue
      manifest[field][entry.name] = field === 'peerDependencies' ? entry.version : `file:${relative(dirname(path), target).split('\\').join('/')}`
      changed = true
    }
    if (changed) write(path, manifest)
  }
  for (const path of ['dependency-snapshots.json', 'vendor/owner-artifacts.json']) {
    const file = join(root, path)
    const manifest = existsSync(file) ? read(file) : { schemaVersion: 1, packages: [] }
    if (!Array.isArray(manifest.packages)) throw Error(`Invalid packages manifest: ${file}`)
    const index = manifest.packages.findIndex(row => row.name === entry.name)
    if (index < 0) manifest.packages.push(entry)
    else manifest.packages[index] = entry
    write(file, manifest)
  }
  run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund'], root)
}

export function releaseContracts(options, { core = process.cwd(), log = console.log } = {}) {
  const { name, version, commit } = options
  const source = realpathSync(resolve(options.source))
  core = realpathSync(core)
  if (git(source, 'status', '--porcelain', '--untracked-files=all')) throw Error(`Dirty source refused: ${source}`)
  if (git(source, 'rev-parse', `${commit}^{commit}`) !== commit) throw Error('Commit must identify a commit object')
  const consumers = (options.consumers ? options.consumers.split(',') : []).map(value => {
    const separator = value.indexOf('=')
    const label = separator < 0 ? value : value.slice(0, separator)
    const path = separator < 0 ? value : value.slice(separator + 1)
    if (!label || !path) throw Error('Expected consumer path or name=path')
    const root = realpathSync(resolve(core, path))
    if (root === core || root === source) throw Error(`Consumer must be separate from Core and source: ${label}`)
    if (!existsSync(join(root, 'package.json'))) throw Error(`Missing consumer package.json: ${label}`)
    return { label, root }
  })
  if (new Set(consumers.map(row => row.root)).size !== consumers.length) throw Error('Duplicate consumer checkout')
  const temporaryRoot = resolve(process.env.DELIVERY_ATTEMPT_ROOT ?? core, process.env.DELIVERY_ATTEMPT_ROOT ? 'tmp' : 'artifacts', 'contracts-release')
  mkdirSync(temporaryRoot, { recursive: true })
  const temporary = mkdtempSync(join(temporaryRoot, 'release-'))
  try {
    const checkout = join(temporary, 'source')
    run('git', ['clone', '--no-hardlinks', '--no-checkout', '--', source, checkout], temporary)
    git(checkout, 'checkout', '--detach', commit)
    const repository = git(source, 'remote', 'get-url', 'origin')
    let archive
    if (name === '@voicechat/shared') {
      run('npm', ['run', 'build:core-contracts', '--', '--version', version, '--commit', commit], checkout)
      archive = join(checkout, 'artifacts/core-contracts', version, `voicechat-shared-${version}.tgz`)
    } else {
      const manifestPath = manifests(checkout).find(path => read(path).name === name)
      if (!manifestPath || read(manifestPath).version !== version) throw Error(`Committed package ${name} must have version ${version}`)
      // Build tools are installed only in the disposable checkout.
      if (existsSync(join(checkout, 'package-lock.json')))
        run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], checkout)
      run('npm', ['pack', '-w', name, '--pack-destination', temporary], checkout)
      const archives = readdirSync(temporary).filter(file => file.endsWith('.tgz'))
      if (archives.length !== 1) throw Error('Expected exactly one packed contract archive')
      archive = join(temporary, archives[0])
    }
    const packed = JSON.parse(run('tar', ['-xOzf', archive, 'package/package.json'], temporary))
    if (packed.name !== name || packed.version !== version) throw Error('Packed contract identity mismatch')
    const bytes = readFileSync(archive)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const filename = `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`
    const entry = {
      name, version, filename, asset: filename.replace(/\.tgz$/, `-${sha256.slice(0, 12)}.tgz`), sha256,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, repository, commit,
      provenance: { schemaVersion: 1, repository, commit, name, version, dirty: false,
        command: name === '@voicechat/shared' ? 'npm run build:core-contracts' : `npm pack -w ${name}` }
    }
    const results = []
    for (const { label, root } of [{ label: 'core', root: core }, ...consumers]) {
      try {
        pin(root, archive, entry)
        if (root !== core) run('npm', ['ci', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund'], root)
        results.push({ consumer: label, status: 'pass' })
      } catch (error) {
        // Preserve npm's ERESOLVE chain (Found / Could not resolve dependency / peer).
        results.push({ consumer: label, status: 'fail', error: error.message })
      }
      log(JSON.stringify(results.at(-1)))
    }
    return { entry, results, ok: results.every(row => row.status === 'pass') }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { if (!releaseContracts(parseArgs(process.argv.slice(2))).ok) process.exitCode = 1 }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
