// Один контейнер раздаёт один неизменяемый frontend-артефакт.
import { createServer } from 'node:http'
import {
  createReadStream,
  readFileSync,
  statSync,
  mkdirSync,
  readdirSync,
  copyFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { APPLICATION_CATALOG } from '../packages/shared/src/applicationCatalog.ts'
import { applicationRuntimeMetadata } from '../packages/shared/src/applicationRelease.ts'
import { parseApplicationFrontendManifest } from '../packages/shared/src/applicationFrontend.ts'
const id = process.env.VC_APPLICATION_ID,
  app = APPLICATION_CATALOG.find((item) => item.id === id && item.frontend)
if (!app) throw new Error('Не задано frontend-приложение')
const directory = resolve(import.meta.dirname, '..', app.paths[0], 'dist')
const manifest = parseApplicationFrontendManifest(
  JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')),
  id
)
const runtime = applicationRuntimeMetadata(id, process.env)
if (
  runtime.version !== manifest.version ||
  runtime.commit !== manifest.commit ||
  runtime.apiVersion !== manifest.apiVersion
)
  throw new Error('Метаданные образа и интерфейса различаются')
// Старые hashed assets сохраняются на собственном томе: открытая вкладка может
// запросить worker или картинку после обновления контейнера. Текущий manifest
// всегда читается из образа, поэтому rollback не меняет его по содержимому тома.
const cache = process.env.VC_DATA_DIR
  ? join(process.env.VC_DATA_DIR, 'assets')
  : directory
function retain(from, to) {
  mkdirSync(to, { recursive: true })
  for (const item of readdirSync(from, { withFileTypes: true })) {
    if (item.name === 'manifest.json') continue
    const source = join(from, item.name),
      target = join(to, item.name)
    if (item.isDirectory()) retain(source, target)
    else if (item.isFile()) {
      try {
        if (!readFileSync(target).equals(readFileSync(source)))
          throw new Error('Коллизия имени immutable asset: ' + item.name)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        copyFileSync(source, target)
      }
    }
  }
}
if (cache !== directory) retain(directory, cache)
const mime = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2'
}
const server = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('x-content-type-options', 'nosniff')
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  const path = (req.url ?? '/').split('?')[0]
  if (path === '/v1/health') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, application: runtime }))
    return
  }
  const file = path.slice(1)
  if (
    !/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(file) ||
    file.split('/').some((part) => part === '.' || part === '..' || !part)
  ) {
    res.writeHead(404)
    res.end()
    return
  }
  const location = join(file === 'manifest.json' ? directory : cache, file)
  try {
    const stat = statSync(location)
    if (!stat.isFile()) throw new Error()
    const extension = file.slice(file.lastIndexOf('.'))
    if (!mime[extension]) throw new Error()
    res.writeHead(200, {
      'content-type': mime[extension],
      'content-length': stat.size,
      'cache-control':
        file === 'manifest.json'
          ? 'no-store'
          : 'public, max-age=31536000, immutable'
    })
    if (req.method === 'HEAD') res.end()
    else
      createReadStream(location)
        .on('error', () => res.destroy())
        .pipe(res)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '0.0.0.0')
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)))
