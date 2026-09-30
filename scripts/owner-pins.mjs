// Proves that a diff only replaces pinned owner artifacts and names the replaced packages.
// Identity is the archive hash and source commit, not the version: an owner can
// republish the same version with different bytes, and that still changes consumers.

const MANIFESTS = ['dependency-snapshots.json', 'vendor/owner-artifacts.json', 'vendor/ui-libraries.json']
const COMPOSE = /^(?:docker-compose\.yml|deploy\/compose\.[\w.-]+\.yml)$/
const PACKAGE_JSON = /^(?:package\.json|(?:apps|packages)\/[\w.-]+\/package\.json)$/

/** Files a pin replacement may touch. Anything else still selects its own owner. */
export function isOwnerPinFile(file) {
  return MANIFESTS.includes(file) || file === 'deploy/tools.lock.json' || COMPOSE.test(file) ||
    PACKAGE_JSON.test(file) || /^vendor\/[\w.@-]+\.tgz$/.test(file)
}

const parse = (text) => {
  if (text === null || text === undefined) return null
  try { return JSON.parse(text) } catch { return undefined }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const without = (value, key) => { const { [key]: _removed, ...rest } = value; return rest }
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const vendorSpec = (spec) => typeof spec === 'string' && /^file:(?:\.\.\/)*vendor\/[\w.@-]+\.tgz$/.test(spec)

/**
 * @param {string[]} files changed paths
 * @param {(file: string) => string | null} readBefore baseline content, null when absent
 * @param {(file: string) => string | null} readAfter candidate content, null when absent
 * @returns {{ packages: string[], tools: string[], images: boolean, archives: string[] } | { unproven: string }}
 */
export function ownerPinChanges(files, readBefore, readAfter) {
  const packages = new Set(), tools = new Set(), archives = []
  let images = false
  const assets = new Map()
  for (const file of files.filter(isOwnerPinFile)) {
    if (MANIFESTS.includes(file)) {
      const before = parse(readBefore(file)), after = parse(readAfter(file))
      if (!before?.packages || !after?.packages) return { unproven: `${file}: не удалось прочитать манифест` }
      if (!same(without(before, 'packages'), without(after, 'packages'))) return { unproven: `${file}: изменены поля вне packages` }
      const rows = (value) => new Map(value.packages.map((row) => [row.name, row]))
      const old = rows(before), next = rows(after)
      for (const [name, row] of [...old, ...next]) {
        if (row?.asset) assets.set(row.asset, name)
        if (!same(old.get(name), next.get(name))) packages.add(name)
      }
      continue
    }
    if (file === 'deploy/tools.lock.json') {
      const before = parse(readBefore(file)), after = parse(readAfter(file))
      if (!before?.tools || !after?.tools) return { unproven: `${file}: не удалось прочитать` }
      if (!same(without(before, 'tools'), without(after, 'tools'))) return { unproven: `${file}: изменены поля вне tools` }
      for (const key of new Set([...Object.keys(before.tools), ...Object.keys(after.tools)])) {
        const a = before.tools[key], b = after.tools[key]
        if (same(a, b)) continue
        if (!a || !b || !same(without(without(a, 'version'), 'commit'), without(without(b, 'version'), 'commit')))
          return { unproven: `${file}: ${key} меняет не только version/commit` }
        tools.add(key)
      }
      continue
    }
    if (COMPOSE.test(file)) {
      const before = readBefore(file), after = readAfter(file)
      if (before === null || after === null) return { unproven: `${file}: файл добавлен или удалён` }
      const a = before.split('\n'), b = after.split('\n')
      if (a.length !== b.length) return { unproven: `${file}: изменена структура` }
      for (let index = 0; index < a.length; index += 1)
        if (a[index] !== b[index] && !(/^\s+image:\s/.test(a[index]) && /^\s+image:\s/.test(b[index])))
          return { unproven: `${file}: изменена строка ${index + 1} кроме image` }
      images = true
      continue
    }
    if (PACKAGE_JSON.test(file)) {
      const before = parse(readBefore(file)), after = parse(readAfter(file))
      if (!before || !after) return { unproven: `${file}: не удалось прочитать` }
      const rest = (value) => Object.fromEntries(Object.entries(value).filter(([key]) => !DEPENDENCY_FIELDS.includes(key)))
      if (!same(rest(before), rest(after))) return { unproven: `${file}: изменены поля кроме зависимостей` }
      for (const field of DEPENDENCY_FIELDS) {
        const a = before[field] ?? {}, b = after[field] ?? {}
        if (!same(Object.keys(a).sort(), Object.keys(b).sort())) return { unproven: `${file}: изменён состав ${field}` }
        for (const name of Object.keys(a)) {
          if (a[name] === b[name]) continue
          if (!vendorSpec(a[name]) || !vendorSpec(b[name])) return { unproven: `${file}: ${name} меняет не архив vendor` }
          packages.add(name)
        }
      }
      continue
    }
    archives.push(file.slice('vendor/'.length))
  }
  for (const archive of archives) {
    const name = assets.get(archive)
    if (!name) return { unproven: `vendor/${archive}: архив не описан в манифестах владельцев` }
    packages.add(name)
  }
  return { packages: [...packages].sort(), tools: [...tools].sort(), images, archives: archives.sort() }
}
