import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FRONTEND = [
  { name: '@voicechat/ui-kit', dir: 'packages/ui-kit', layer: 'shared' },
  // Модуль сессий переносим целиком: он лежит слоем «shared», потому что его
  // берут и хост-приложение, и админка, а собственного маршрута у него нет.
  { name: '@voicechat/sessions-app', dir: 'packages/sessions-app', layer: 'shared' },
  // Карточка человека: её показывают и админка (чужой профиль), и страница
  // «Мой аккаунт» (свой). Слой shared — потому что product→product импорт
  // запрещён, а общий код нужен обоим.
  { name: '@voicechat/profile-app', dir: 'packages/profile-app', layer: 'shared' },
  { name: '@voicechat/app-shell', dir: 'packages/app-shell', layer: 'shell' },
  { name: '@voicechat/chat-app', dir: 'packages/chat-app', layer: 'product' },
  { name: '@voicechat/web-reader-app', dir: 'packages/web-reader-app', layer: 'product' },
  { name: '@voicechat/playwright-reader-app', dir: 'packages/playwright-reader-app', layer: 'product' },
  { name: '@voicechat/projects-app', dir: 'packages/projects-app', layer: 'product' },
  { name: '@voicechat/operations-app', dir: 'packages/operations-app', layer: 'product' },
  { name: '@voicechat/admin-app', dir: 'packages/admin-app', layer: 'product' },
  { name: '@voicechat/ui', dir: 'packages/ui', layer: 'host' },
  { name: '@voicechat/web', dir: 'apps/web', layer: 'platform' }
]
const PRODUCT_NAMES = new Set(FRONTEND.filter((item) => item.layer === 'product').map((item) => item.name))
const SECRET = /(bearer\s+[a-z0-9._-]+|(?:token|password|secret)=([^&\s]+)|https?:\/\/[^/\s:@]+:[^/\s@]+@)/gi
function files(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? files(path) : ['.ts', '.tsx', '.css', '.js'].includes(extname(path)) ? [path] : []
  })
}
function imports(source) {
  return [...source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|@import\s+['"]([^'"]+)['"]/g)].map((m) => m[1] || m[2] || m[3])
}
function fail(message, detail) { const error = new Error(message); error.detail = detail; throw error }
const packageOf = (specifier) => specifier.match(/^(@voicechat\/[^/]+)/)?.[1] ?? null

export function checkArchitecture({ root = ROOT, packages = FRONTEND } = {}) {
  const edges = new Map(packages.map((item) => [item.name, new Set()]))
  for (const item of packages) for (const file of files(join(root, item.dir, 'src'))) {
    if (/\.(?:test|stories)\.[tj]sx?$/.test(file)) continue
    const source = readFileSync(file, 'utf8')
    for (const specifier of imports(source)) {
      const dependency = packageOf(specifier)
      if (!dependency || !edges.has(dependency)) continue
      if (specifier !== dependency && specifier !== `${dependency}/styles.css` && !(dependency === '@voicechat/ui' && specifier === '@voicechat/ui/app.css')) fail('deep workspace import', `${relative(root, file)} -> ${specifier}`)
      edges.get(item.name).add(dependency)
      if (item.layer === 'product' && (dependency === '@voicechat/app-shell' || dependency === '@voicechat/ui' || dependency === '@voicechat/web' || (PRODUCT_NAMES.has(dependency) && !(dependency === '@voicechat/chat-app' && /reader-app$/.test(item.name))))) fail('product boundary violation', `${relative(root, file)} -> ${specifier}`)
      if (item.layer === 'shell' && (PRODUCT_NAMES.has(dependency) || dependency === '@voicechat/ui')) fail('shell boundary violation', `${relative(root, file)} -> ${specifier}`)
    }
    if (item.layer === 'product' && /\b(fetch|WebSocket|EventSource)\b|from\s*['"]electron['"]|\bwindow\s*\./.test(source)) fail('transport or platform leak', relative(root, file))
  }
  const visiting = new Set(), visited = new Set()
  const visit = (name, trail = []) => {
    if (visiting.has(name)) fail('frontend dependency cycle', [...trail, name].join(' -> '))
    if (visited.has(name)) return
    visiting.add(name)
    for (const next of edges.get(name) ?? []) visit(next, [...trail, name])
    visiting.delete(name); visited.add(name)
  }
  for (const name of edges.keys()) visit(name)
  return { packages: packages.length, edges: [...edges.values()].reduce((sum, set) => sum + set.size, 0) }
}
export function checkExports({ root = ROOT, packages = FRONTEND.filter((item) => item.layer !== 'platform') } = {}) {
  for (const item of packages) {
    const json = JSON.parse(readFileSync(join(root, item.dir, 'package.json'), 'utf8'))
    if (!json.exports?.['.']) fail('missing public root export', item.name)
    if (!json.exports?.['./styles.css']) fail('missing stable styles export', item.name)
    for (const target of Object.values(json.exports)) if (typeof target === 'string' && !existsSync(join(root, item.dir, target))) fail('export target missing', `${item.name}: ${target}`)
  }
  return { packages: packages.length }
}
const STORY_MATRIX = {
  'packages/app-shell/src/AppShell.stories.tsx': ['Default', 'ModuleFailure'],
  'packages/chat-app/src/surfaces.stories.tsx': ['Empty', 'Messages', 'StreamingQueued', 'Disconnected'],
  'packages/web-reader-app/src/WebReaderApp.stories.tsx': ['Default', 'Empty', 'RecorderReady', 'ActionPending', 'Mobile'],
  'packages/playwright-reader-app/src/PlaywrightReaderApp.stories.tsx': ['Default', 'SessionConnected', 'CapabilityUnavailable', 'Mobile'],
  'packages/projects-app/src/ProjectsApp.stories.tsx': ['Default', 'Loading', 'KanbanLongCards'],
  'packages/operations-app/src/Operations.stories.tsx': ['MachinesOnline', 'MachinesOffline', 'UtilityRestricted'],
  'packages/admin-app/src/AdminApp.stories.tsx': ['Overview', 'EmptyUsage', 'AccessMatrix'],
  'packages/sessions-app/src/SessionsApp.stories.tsx': ['Default', 'SingleDevice', 'ReadOnly', 'LoadFailed', 'Empty'],
  'packages/profile-app/src/ProfileApp.stories.tsx': ['AdminView', 'SelfView', 'Empty', 'Mobile']
}
export function checkStories({ root = ROOT, matrix = STORY_MATRIX } = {}) {
  for (const [path, stories] of Object.entries(matrix)) {
    if (!existsSync(join(root, path))) fail('missing module Storybook harness', path)
    const source = readFileSync(join(root, path), 'utf8')
    for (const story of stories) if (!new RegExp(`export\\s+const\\s+${story}\\b`).test(source)) fail('missing required story state', `${path}: ${story}`)
  }
  return { modules: Object.keys(matrix).length, stories: Object.values(matrix).flat().length }
}
export function checkCss({ root = ROOT } = {}) {
  const styles = FRONTEND.filter((item) => ['product', 'shell'].includes(item.layer)).map((item) => [item, join(root, item.dir, 'src/styles.css')])
  const keyframes = new Map()
  for (const [item, path] of styles) {
    if (!existsSync(path)) fail('missing isolated module stylesheet', item.name)
    const source = readFileSync(path, 'utf8')
    for (const specifier of imports(source)) if (specifier.startsWith('@voicechat/') && specifier !== '@voicechat/ui-kit/styles.css') fail('cross-module stylesheet import', `${item.name} -> ${specifier}`)
    for (const match of source.matchAll(/@keyframes\s+([\w-]+)/g)) {
      if (keyframes.has(match[1])) fail('duplicate keyframe', `${match[1]} in ${keyframes.get(match[1])} and ${item.name}`)
      keyframes.set(match[1], item.name)
    }
    for (const raw of source.replace(/@media[^{}]*\{/g, '').match(/(?:^|})\s*([^@{}][^{}]*)\{/g) ?? []) for (const part of raw.replace(/^}/, '').trim().split(',')) {
      if (/^(?:html|body|:root|\*|[a-z][\w-]*)\b/.test(part.trim())) fail('unscoped product selector', `${item.name}: ${part.trim()}`)
    }
  }
  return { stylesheets: styles.length, keyframes: keyframes.size }
}
export function checkLazyRegistry({ root = ROOT } = {}) {
  const source = readFileSync(join(root, 'packages/ui/src/moduleRegistry.ts'), 'utf8')
  for (const name of PRODUCT_NAMES) if (!source.includes(`import('${name}')`)) fail('missing lazy module import', name)
  const adminDynamic = source.indexOf("import('@voicechat/admin-app')"), adminGate = source.indexOf("['admin']")
  if (adminDynamic < 0 || adminGate < adminDynamic) fail('Admin role gate must be declared with lazy loader', 'admin')
  return { lazyProducts: PRODUCT_NAMES.size }
}
export function redact(value) { return String(value).replace(SECRET, '[REDACTED]') }
export function writeReport(results, { root = ROOT } = {}) {
  const output = join(root, 'artifacts/frontend-quality/report.json')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), results }, null, 2))
  return relative(root, output)
}
export function runStatic(options = {}) {
  return { architecture: checkArchitecture(options), exports: checkExports(options), stories: checkStories(options), css: checkCss(options), lazyLoading: checkLazyRegistry(options) }
}
export function checkBundle({ root = ROOT } = {}) {
  const baseline = JSON.parse(readFileSync(join(root, 'frontend-quality/bundle-baseline.json'), 'utf8'))
  const assets = files(join(root, 'apps/web/dist/assets')).filter((path) => extname(path) === '.js')
  const measured = {}
  for (const [group, limit] of Object.entries(baseline.maxBytes)) {
    const matches = assets.filter((path) => relative(join(root, 'apps/web/dist/assets'), path).startsWith(group))
    const actual = matches.reduce((sum, path) => sum + statSync(path).size, 0)
    measured[group] = actual
    if (!matches.length) fail('required bundle chunk missing', group)
    if (actual > limit) fail('bundle budget exceeded', `${group}: limit=${limit} actual=${actual} delta=+${actual - limit}`)
  }
  const total = assets.reduce((sum, path) => sum + statSync(path).size, 0)
  if (total > baseline.totalJsMaxBytes) fail('total JS budget exceeded', `limit=${baseline.totalJsMaxBytes} actual=${total} delta=+${total - baseline.totalJsMaxBytes}`)
  if (assets.filter((path) => /(?:^|-)react-/.test(path.split('/').pop())).length !== 1) fail('React runtime duplicated', 'expected exactly one react chunk')
  return { measured, total, baseline: baseline.measuredAt }
}
function main() {
  const results = {}
  try {
    if (process.argv.includes('--bundle')) results.bundle = checkBundle()
    else Object.assign(results, runStatic())
    console.log(`[frontend-quality] gates passed; report: ${writeReport(results)}`)
  } catch (error) {
    results.failure = { message: redact(error.message), detail: redact(error.detail ?? '') }
    console.error(`[frontend-quality] ${results.failure.message}: ${results.failure.detail}; report: ${writeReport(results)}`)
    process.exitCode = 1
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
