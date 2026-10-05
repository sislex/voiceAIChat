import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute, join } from 'node:path'

export function loadConfig(start = process.cwd()) {
  let root = resolve(start)
  let packageRoot
  while (!existsSync(join(root, 'kb.config.json')) && !existsSync(join(root, '.git'))) {
    if (!packageRoot && existsSync(join(root, 'package.json'))) packageRoot = root
    const parent = dirname(root)
    if (parent === root) { root = packageRoot ?? resolve(start); break }
    root = parent
  }
  const path = join(root, 'kb.config.json')
  const custom = existsSync(path)
  const input = custom ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const config = { kbDir: 'docs/kb', packageGlobs: ['apps/*', 'packages/*'],
    indexTitle: 'База знаний voiceAIChat', logDir: `${input.kbDir ?? 'docs/kb'}/log`,
    indexPath: `${input.kbDir ?? 'docs/kb'}/README.md`, generatedIndexPath: 'generated/kb', ...input }
  for (const key of ['kbDir', 'logDir', 'indexPath', 'generatedIndexPath']) {
    const value = config[key]
    if (typeof value !== 'string' || !value || isAbsolute(value) || relative(root, resolve(root, value)).startsWith('..'))
      throw Error(`kb.config.json: ${key} must be a repository-relative path`)
  }
  if (typeof config.indexTitle !== 'string' || !config.indexTitle.trim()) throw Error('kb.config.json: indexTitle must be a nonempty string')
  if (!Array.isArray(config.packageGlobs) || config.packageGlobs.some(g => typeof g !== 'string' || !g || g.startsWith('/') || g.split('/').includes('..') || /[^a-zA-Z0-9_.*?/-]/.test(g)))
    throw Error('kb.config.json: packageGlobs must be an array of relative globs')
  const output = resolve(root, config.generatedIndexPath)
  for (const source of [config.kbDir, config.logDir, config.indexPath, 'kb.config.json', 'package.json', '.git']) {
    const rel = relative(output, resolve(root, source))
    if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw Error('kb.config.json: generatedIndexPath must not contain source files')
  }
  return { ...config, root, custom }
}

export function packageDirectories(root, globs) {
  const found = new Set()
  const directories = dir => existsSync(dir) ? readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !['node_modules', '.git'].includes(e.name)).map(e => e.name) : []
  function visit(dir, parts) {
    if (!parts.length) { found.add(relative(root, dir)); return }
    const [part, ...rest] = parts
    if (part === '**') {
      visit(dir, rest)
      for (const name of directories(dir)) visit(join(dir, name), parts)
    } else {
      const pattern = new RegExp('^' + part.split('').map(c => c === '*' ? '.*' : c === '?' ? '.' : c === '.' ? '\\.' : c).join('') + '$')
      for (const name of directories(dir)) if (pattern.test(name)) visit(join(dir, name), rest)
    }
  }
  for (const glob of globs) visit(root, glob.split('/'))
  return [...found].sort()
}
