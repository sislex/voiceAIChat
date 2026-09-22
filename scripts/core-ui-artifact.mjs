import { createRequire } from 'node:module'
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
export function coreUiDirectory(part = 'web') {
  if (!['web', 'renderer', 'storybook'].includes(part)) throw Error('Unknown Core UI artifact')
  return dirname(require.resolve(`@sislexa/core-ui/${part}/index.html`))
}
export function verifyCoreUi(directory = dirname(require.resolve('@sislexa/core-ui/manifest.json'))) {
  const root = realpathSync(directory)
  const source = JSON.parse(readFileSync(resolve(root, 'release-source.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))
  if (source.repository !== 'https://github.com/sislex/sislexa-core-ui' || source.dirty !== false || !/^[a-f0-9]{40}$/.test(source.commit) || !/^\d+\.\d+\.\d+$/.test(source.version)) throw Error('Invalid Core UI provenance')
  if (source.requires?.coreApi !== '^1.0.0') throw Error('Unsupported Core UI API requirement')
  if (manifest.schemaVersion !== 1 || manifest.commit !== source.commit || manifest.version !== source.version || !manifest.files || typeof manifest.files !== 'object') throw Error('Core UI manifest mismatch')
  for (const entry of ['web/index.html', 'renderer/index.html', 'storybook/index.html']) if (!manifest.files[entry]) throw Error('Missing Core UI entry: ' + entry)
  for (const [path, digest] of Object.entries(manifest.files)) {
    if (!/^(?:(?:web|renderer|storybook)\/.+|legacy\.(?:js|d\.ts))$/.test(path) || path.includes('..') || isAbsolute(path) || path.includes('\\') || !/^[a-f0-9]{64}$/.test(digest)) throw Error('Invalid Core UI asset path/digest')
    const file = resolve(root, path)
    if (!lstatSync(file).isFile() || realpathSync(file) !== file || !file.startsWith(root + '/')) throw Error('Unsafe Core UI asset')
    if (createHash('sha256').update(readFileSync(file)).digest('hex') !== digest) throw Error('Core UI integrity mismatch: ' + path)
  }
  const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isSymbolicLink()) throw Error('Core UI symlink is forbidden')
    if (entry.isDirectory()) walk(path)
    else if (!manifest.files[relative(root, path)]) throw Error('Unlisted Core UI asset')
  } }
  for (const part of ['web', 'renderer', 'storybook']) walk(resolve(root, part))
  return source
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = verifyCoreUi()
  console.log(`[core-ui] verified ${source.version} (${source.commit})`)
}
