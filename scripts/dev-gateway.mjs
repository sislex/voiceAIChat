import http from 'node:http'
import https from 'node:https'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEV_COMPONENT_REGISTRY, validateDevStandManifest } from '../packages/shared/src/devStand.ts'

const routes = Object.entries(DEV_COMPONENT_REGISTRY).flatMap(([id, component]) =>
  component.routePrefixes.map(prefix => ({ id, prefix }))).sort((a, b) => b.prefix.length - a.prefix.length)
export function targetFor(manifest, path, baseUrl) {
  const pathname = new URL(path, 'http://gateway').pathname
  const route = routes.find(({ prefix }) => prefix === '/' || pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'))
  const component = route && manifest.components[route.id]
  return component?.source === 'dev' && component.url ? component.url : baseUrl
}

/** Read at request boundaries so atomic owner renames are visible without restarting. */
export function createGateway({ manifestPath, baseUrl, onError = console.error }) {
  if (!['http:', 'https:'].includes(new URL(baseUrl).protocol)) throw Error('Base stand must be an HTTP(S) Caddy URL')
  const forward = (req, downstream, head) => {
    let target
    try {
      const manifest = validateDevStandManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
      target = new URL(targetFor(manifest, req.url, baseUrl))
    } catch (error) {
      onError(error)
      if (head !== undefined) downstream.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      else { downstream.writeHead(503); downstream.end('invalid_dev_stand_manifest') }
      return
    }
    const headers = { ...req.headers, host: target.host, 'x-forwarded-host': req.headers.host,
      'x-forwarded-proto': 'http', 'x-forwarded-for': req.socket.remoteAddress }
    const upstream = (target.protocol === 'https:' ? https : http).request(target, {
      method: req.method, path: target.pathname.replace(/\/$/, '') + req.url, headers
    })
    upstream.on('error', error => {
      onError(error)
      if (head !== undefined) downstream.destroy()
      else if (!downstream.headersSent) { downstream.writeHead(502); downstream.end('dev_upstream_unavailable') }
      else downstream.destroy()
    })
    downstream.on('close', () => upstream.destroy())
    downstream.on('error', () => upstream.destroy())
    upstream.on('response', response => {
      if (head !== undefined) { downstream.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`); response.resume(); return }
      downstream.writeHead(response.statusCode, response.headers)
      downstream.flushHeaders()
      response.on('error', () => downstream.destroy())
      response.pipe(downstream)
    })
    upstream.on('upgrade', (response, socket, upstreamHead) => {
      downstream.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` +
        response.rawHeaders.reduce((lines, value, index, all) => index % 2 ? lines : lines + `${value}: ${all[index + 1]}\r\n`, '') + '\r\n')
      if (upstreamHead.length) downstream.write(upstreamHead)
      if (head?.length) socket.write(head)
      socket.on('error', () => downstream.destroy())
      downstream.on('error', () => socket.destroy())
      downstream.on('close', () => socket.destroy())
      socket.pipe(downstream).pipe(socket)
    })
    req.on('aborted', () => upstream.destroy())
    req.pipe(upstream)
  }
  const server = http.createServer((req, res) => forward(req, res))
  server.on('upgrade', (req, socket, head) => forward(req, socket, head))
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { SISLEXA_STAND_MANIFEST, SISLEXA_BASE_STAND_URL, SISLEXA_GATEWAY_PORT, SISLEXA_GATEWAY_HOST = '0.0.0.0' } = process.env
  const port = Number(SISLEXA_GATEWAY_PORT)
  if (!SISLEXA_STAND_MANIFEST || !SISLEXA_BASE_STAND_URL || !Number.isInteger(port) || port < 1 || port > 65535)
    throw Error('Set SISLEXA_STAND_MANIFEST, SISLEXA_BASE_STAND_URL and allocated SISLEXA_GATEWAY_PORT')
  const server = createGateway({ manifestPath: SISLEXA_STAND_MANIFEST, baseUrl: SISLEXA_BASE_STAND_URL })
  server.listen(port, SISLEXA_GATEWAY_HOST)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
}
