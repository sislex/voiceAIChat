
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative, dirname, extname } from 'node:path'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'
import { createHash } from 'node:crypto'
import { parse } from 'acorn'
import { fileURLToPath } from 'node:url'

export const COMPRESSION = { gzip: { level: 9 }, brotli: { quality: 11 } }
const fail = message => { throw new Error('[route-budget] ' + message) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const positive = value => Number.isSafeInteger(value) && value > 0
export function completedResource(request) {
  return request.finished === true && (request.status === 200 || request.status === 304 || (request.status === 0 && request.url.startsWith('file:')))
}
export function sizes(bytes) {
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length }
}
export function inventory(directory) {
  const root = resolve(directory), resources = {}
  const walk = path => {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const full = resolve(path, item.name)
      if (item.isDirectory()) walk(full)
      else if (/\.(?:js|css)$/.test(item.name)) {
        const bytes = readFileSync(full), id = relative(root, full).replaceAll('\\', '/')
        resources[id] = { type: extname(id).slice(1), sha256: createHash('sha256').update(bytes).digest('hex'), ...sizes(bytes), imports: [], dynamicImports: [] }
        if (id.endsWith('.js')) {
          const ast = parse(bytes.toString(), { ecmaVersion: 'latest', sourceType: 'module' })
          const visit = node => {
            if (!node || typeof node !== 'object') return
            if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) resources[id].imports.push(relative(root, resolve(dirname(full), node.source.value)).replaceAll('\\', '/'))
            if (node.type === 'ImportExpression' && typeof node.source.value === 'string') resources[id].dynamicImports.push(relative(root, resolve(dirname(full), node.source.value)).replaceAll('\\', '/'))
            for (const value of Object.values(node)) {
              if (Array.isArray(value)) value.forEach(visit)
              else if (value && typeof value === 'object') visit(value)
            }
          }
          visit(ast)
        }
      }
    }
  }
  walk(root)
  for (const [id, resource] of Object.entries(resources)) for (const dependency of [...resource.imports, ...resource.dynamicImports]) {
    if (!resources[dependency]) fail(id + ': missing dependency ' + dependency)
  }
  return resources
}
export function resourceSet(resources, requested) {
  if (!Array.isArray(requested) || !requested.length) fail('empty initial resource set')
  const seen = new Set()
  const visit = id => {
    if (seen.has(id)) return
    const resource = resources[id]
    if (!resource || !Array.isArray(resource.imports)) fail('missing/invalid resource ' + id)
    seen.add(id)
    resource.imports.forEach(visit)
  }
  requested.forEach(visit)
  return [...seen].sort()
}
export function totals(resources, ids) {
  const result = { js: { raw: 0, gzip: 0, brotli: 0 }, css: { raw: 0, gzip: 0, brotli: 0 } }
  for (const id of resourceSet(resources, ids)) {
    const r = resources[id]
    if (!result[r.type]) fail('invalid resource type ' + id)
    for (const metric of ['raw', 'gzip', 'brotli']) {
      if (!positive(r[metric])) fail('invalid ' + metric + ': ' + id)
      result[r.type][metric] += r[metric]
    }
  }
  return result
}
export function compareRoutes(before, after) {
  if (!object(before) || !object(after) || !object(before.routes) || !object(after.routes) || before.schemaVersion !== 1 || after.schemaVersion !== 1) fail('invalid comparison schema')
  for (const field of new Set([...Object.keys(before.conditions ?? {}), ...Object.keys(after.conditions ?? {})])) {
    if (JSON.stringify(before.conditions?.[field]) !== JSON.stringify(after.conditions?.[field])) fail('incomparable condition: ' + field)
  }
  if (JSON.stringify(before.compression) !== JSON.stringify(after.compression) || JSON.stringify(before.tools) !== JSON.stringify(after.tools)) fail('incomparable tools or compression')
  if (Object.keys(before.routes).sort().join() !== Object.keys(after.routes).sort().join()) fail('incomplete comparison routes')
  for (const report of [before, after]) checkRoutes({ schemaVersion: 1, routes: Object.fromEntries(Object.entries(report.routes).map(([id, route]) => [id, totals(report.resources, route.initial)])) }, report)
  const diff = []
  for (const [route, measured] of Object.entries(after.routes)) {
    const original = totals(before.resources, before.routes[route].initial)
    const current = totals(after.resources, measured.initial)
    for (const type of ['js', 'css']) for (const metric of ['raw', 'gzip', 'brotli']) {
      const baseline = original[type][metric], actual = current[type][metric]
      diff.push({ route, metric: type + '.' + metric, baseline, actual, delta: actual - baseline, percent: Number(((actual / baseline - 1) * 100).toFixed(2)) })
    }
  }
  return diff
}
export function checkRoutes(budget, report) {
  if (!object(budget) || budget.schemaVersion !== 1 || !object(budget.routes) || !Object.keys(budget.routes).length) fail('invalid budget schema')
  if (Object.keys(budget).some(key => !['schemaVersion', 'routes', 'forbiddenInitial', 'notes'].includes(key))) fail('unknown budget field')
  if (budget.notes !== undefined && typeof budget.notes !== 'string') fail('invalid budget notes')
  if (budget.forbiddenInitial !== undefined && (!object(budget.forbiddenInitial) || Object.keys(budget.forbiddenInitial).some(id => !Object.hasOwn(budget.routes, id)))) fail('unknown forbidden-resource route')
  if (!object(report) || report.schemaVersion !== 1 || !object(report.routes) || !object(report.resources)) fail('invalid measurement schema')
  if (!/^[a-f0-9]{40}$/.test(report.commit ?? '') || !object(report.conditions) || !object(report.tools) || !report.tools.web || !report.tools.electron) fail('missing build or runtime provenance')
  for (const field of ['scenario', 'theme', 'transport', 'node', 'zlib', 'brotli', 'cpu', 'network', 'cache']) if (typeof report.conditions[field] !== 'string' || !report.conditions[field]) fail('missing measurement condition: ' + field)
  if (!object(report.conditions.viewport) || !positive(report.conditions.viewport.width) || !positive(report.conditions.viewport.height) || !positive(report.conditions.settleMs)) fail('missing viewport or readiness boundary')
  for (const client of ['web', 'electron']) {
    const viewport = report.conditions.actualViewports?.[client]
    if (!object(viewport) || !positive(viewport.width) || !positive(viewport.height) || !Number.isFinite(viewport.deviceScaleFactor) || viewport.deviceScaleFactor <= 0) fail('missing actual renderer viewport: ' + client)
  }
  if (JSON.stringify(report.compression) !== JSON.stringify(COMPRESSION)) fail('incompatible compression settings')
  for (const [id, resource] of Object.entries(report.resources)) {
    if (!object(resource) || !['js', 'css'].includes(resource.type) || !/^[a-f0-9]{64}$/.test(resource.sha256 ?? '') || !Array.isArray(resource.imports) || !Array.isArray(resource.dynamicImports)) fail('invalid chunk graph resource ' + id)
    for (const metric of ['raw', 'gzip', 'brotli']) if (!positive(resource[metric])) fail('invalid resource metric ' + id + ': ' + metric)
    for (const dependency of [...resource.imports, ...resource.dynamicImports]) if (typeof dependency !== 'string' || !Object.hasOwn(report.resources, dependency)) fail('missing chunk graph dependency ' + id + ': ' + dependency)
  }
  const expected = Object.keys(budget.routes).sort(), actual = Object.keys(report.routes).sort()
  if (JSON.stringify(expected) !== JSON.stringify(actual)) fail('incomplete route set: expected ' + expected + '; actual ' + actual)
  const diff = []
  for (const id of expected) {
    const route = report.routes[id], limits = budget.routes[id]
    if (!object(route) || route.ready !== true || !Array.isArray(route.waterfall) || !route.waterfall.length) fail(id + ': incomplete ready/waterfall measurement')
    if (!Array.isArray(route.initial) || new Set(route.initial).size !== route.initial.length) fail(id + ': invalid unique initial set')
    const closure = resourceSet(report.resources, route.initial)
    for (const resource of closure) {
      const entry = report.resources[resource]
      if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !Array.isArray(entry.dynamicImports)) fail(id + ': incomplete chunk graph or fingerprint ' + resource)
      for (const dependency of entry.dynamicImports) if (!report.resources[dependency]) fail(id + ': missing dynamic dependency ' + dependency)
    }
    if (JSON.stringify(closure) !== JSON.stringify([...route.initial].sort())) fail(id + ': incomplete dependency closure')
    for (const resource of closure) if (!route.waterfall.some(row => row.resource === resource && row.ok === true && Number.isFinite(row.start) && Number.isFinite(row.duration))) fail(id + ': unobserved initial resource ' + resource)
    if (!Array.isArray(route.errors)) fail(id + ': missing runtime error measurement')
    if (route.errors.length) fail(id + ': runtime errors: ' + route.errors.join('; '))
    for (const row of route.waterfall) {
      if (!closure.includes(row.resource) || row.ok !== true) fail(id + ': incomplete or failed observed resource ' + row.resource)
    }
    const forbidden = budget.forbiddenInitial?.[id] ?? []
    if (!Array.isArray(forbidden) || forbidden.some(value => typeof value !== 'string' || !value)) fail(id + ': invalid forbidden-resource list')
    for (const resource of closure) if (forbidden.some(value => resource.includes(value))) fail(id + ': forbidden initial resource ' + resource)
    const measured = totals(report.resources, closure)
    for (const type of ['js', 'css']) for (const metric of ['raw', 'gzip', 'brotli']) if (route.totals?.[type]?.[metric] !== measured[type][metric]) fail(id + ': missing or inconsistent total ' + type + '.' + metric)
    if (!object(limits) || Object.keys(limits).sort().join() !== 'css,js') fail(id + ': invalid metric groups')
    for (const type of ['js', 'css']) {
      if (!object(limits[type]) || Object.keys(limits[type]).sort().join() !== 'brotli,gzip,raw') fail(id + ': incomplete ' + type + ' limits')
      if (measured[type].raw === 0) fail(id + ': missing ' + type + ' measurement')
      for (const metric of ['raw', 'gzip', 'brotli']) {
        const limit = limits[type][metric], value = measured[type][metric]
        if (!positive(limit)) fail(id + ': invalid limit ' + type + '.' + metric)
        diff.push({ route: id, metric: type + '.' + metric, actual: value, limit, delta: value - limit, resources: closure.filter(key => report.resources[key].type === type) })
      }
    }
  }
  const exceeded = diff.filter(row => row.delta > 0)
  if (exceeded.length) fail('exceeded\n' + exceeded.map(row => JSON.stringify(row)).join('\n'))
  return diff
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [budget, report, candidate] = process.argv.slice(2)
    if (budget === '--compare' && report && candidate) {
      console.log(JSON.stringify(compareRoutes(JSON.parse(readFileSync(report)), JSON.parse(readFileSync(candidate))), null, 2))
      process.exit(0)
    }
    if (budget === '--imports' && report) {
      const ast = parse(readFileSync(report, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
      console.log(JSON.stringify(ast.body.filter(node => node.type === 'ImportDeclaration').map(node => ({ source: node.source.value, bindings: node.specifiers.map(specifier => ({ imported: specifier.imported?.name, local: specifier.local.name })) })), null, 2))
      process.exit(0)
    }
    if (!budget || !report) fail('usage: node scripts/route-budgets.mjs BUDGET REPORT')
    console.log(JSON.stringify(checkRoutes(JSON.parse(readFileSync(budget)), JSON.parse(readFileSync(report))), null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
