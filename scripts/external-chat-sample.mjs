import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import tar from 'tar-stream'

// E02 is an immutable consumer fixture, not an upgrade of Core's owner packages.
const archive = new URL('../vendor/sislexa-sdk-e02-7f45178ee737.tgz', import.meta.url)
const digest = '629530a3a2a4256502b8e8c6b5b43d8fba01e412b5430690da6e82e75a027ab4'
export async function createExternalChatSampleServer() {
  const bytes = await readFile(archive)
  if (createHash('sha256').update(bytes).digest('hex') !== digest) throw Error('E02 SDK artifact mismatch')
  const modules = new Map()
  const extract = tar.extract()
  extract.on('entry', (header, stream, next) => {
    const chunks = []
    stream.on('data', chunk => chunks.push(chunk))
    stream.on('end', () => {
      if (header.type === 'file' && /^package\/dist\/[A-Za-z]+\.js$/.test(header.name)) {
        modules.set('/sdk/' + header.name.slice('package/dist/'.length), Buffer.concat(chunks))
      }
      next()
    })
  })
  await pipeline(Readable.from([bytes]), createGunzip(), extract)
  const html = await readFile(new URL('./external-chat-sample/index.html', import.meta.url))
  const client = await readFile(new URL('./external-chat-sample/client.mjs', import.meta.url))
  return createServer((req, res) => {
    const path = new URL(req.url, 'http://sample').pathname
    const body = path === '/' ? html : path === '/client.mjs' ? client : modules.get(path)
    res.setHeader('cache-control', 'no-store')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('content-type', path === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8')
    res.statusCode = body ? 200 : 404
    res.end(body ?? 'Not found')
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ports = (process.env.DELIVERY_PORTS ?? '').match(/\d+/g)?.map(Number)
  if (!ports?.[1]) throw Error('DELIVERY_PORTS must contain an allocated sample port')
  const server = await createExternalChatSampleServer()
  server.listen(ports[1], '127.0.0.1', () => console.log('External chat sample: http://127.0.0.1:' + ports[1]))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
}
