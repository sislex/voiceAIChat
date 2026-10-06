// @ts-check
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { isTest, root, workspaceEntries } from './test-files.mjs'

function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) return []
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : []
  })
}

// Inspect one import edge only. Never recurse through a production dependency.
function directlyImports(test, changed) {
  const source = readFileSync(test, 'utf8')
  return [...source.matchAll(/(?:from\s*|import\s*\(|import\s*|require\s*\()\s*['"]([^'"]+)['"]/g)]
    .filter(match => match[1].startsWith('.'))
    .some(match => {
      const target = resolve(dirname(test), match[1])
      const stem = target.replace(/\.[cm]?jsx?$/, '')
      return [target, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
        .flatMap(extension => [stem + extension, resolve(target, 'index' + extension)])]
        .some(candidate => changed.has(candidate))
    })
}

export function taskTests(files, repository = root) {
  const owners = [...workspaceEntries(repository).map(workspace => workspace.path), 'scripts']
  const owner = file => owners.find(path => file.startsWith(path + '/'))
  const changed = new Set(files.filter(file => owner(file)).map(file => resolve(repository, file)))
  const candidates = owners.flatMap(path => walk(resolve(repository, path))).filter(isTest)
  const selected = new Set(files.filter(file => owner(file) && isTest(file) && existsSync(resolve(repository, file))))
  const sources = files.filter(file => owner(file) && !isTest(file) && /\.[cm]?[jt]sx?$/.test(file))
  for (const source of sources) {
    const stem = basename(source).replace(/\.[cm]?[jt]sx?$/, '')
    for (const test of candidates) {
      const file = relative(repository, test)
      if (owner(file) === owner(source) &&
        [stem + '.test', stem + '.dom.test', stem + '.spec'].includes(basename(test).replace(/\.[cm]?[jt]sx?$/, '')))
        selected.add(file)
    }
  }
  const importers = candidates.filter(test => !selected.has(relative(repository, test)) && directlyImports(test, changed))
  if (importers.length <= 10) for (const test of importers) selected.add(relative(repository, test))
  return { files: [...selected], deferred: importers.length > 10 ? importers.length : 0 }
}
