// Static checks inspect the pinned implementation, not an empty compatibility shim.
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
export function implementationPath(repo, path) {
  const absolute = resolve(repo, path)
  const parts = relative(repo, absolute).split('/')
  if (parts.length < 2 || !['apps', 'packages'].includes(parts[0])) return absolute
  const manifest = join(repo, ...parts.slice(0, 2), 'package.json')
  if (!existsSync(manifest)) return absolute
  const external = JSON.parse(readFileSync(manifest, 'utf8')).sislexaExternal
  if (!external) return absolute
  const require = createRequire(join(repo, 'package.json'))
  const root = dirname(require.resolve(external.package + '/package.json'))
  return join(root, external.workspace, ...parts.slice(2))
}
