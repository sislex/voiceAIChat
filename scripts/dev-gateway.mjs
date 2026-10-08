import http from 'node:http'
import https from 'node:https'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEV_COMPONENT_REGISTRY, DEV_GATEWAY_VERSION, DEV_GATEWAY_HEALTH_PATH, readDevGatewayManifest } from '../packages/shared/src/devStand.ts'

const routes = Object.entries(DEV_COMPONENT_REGISTRY).flatMap(([id, component]) =>
  component.routePrefixes.map(prefix => ({ id, prefix }))).sort((a, b) => b.prefix.length - a.prefix.length)
export function targetFor(manifest, path, baseUrl) {
  const pathname = new URL(path, 'http://gateway').pathname
  const route = routes.find(({ prefix }) => prefix === '/' || pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'))
  const component = route && manifest.components[route.id]
  return component?.source === 'dev' && component.url ? component.url : baseUrl
}

/** An HTTP response proves reachability, not application readiness or authorization. */
export function probeUpstream(url, timeoutMs = 2000) {
  return new Promise(resolve => {
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.destroy()
      resolve(result)
    }
    const request = (url.protocol === 'https:' ? https : http).get(url, response => {
      finish({ reachable: true, statusCode: response.statusCode })
      response.destroy()
    })
    const timer = setTimeout(() => finish({ reachable: false }), timeoutMs)
    request.on('error', () => finish({ reachable: false }))
  })
}

/** Read at request boundaries so atomic owner renames are visible without restarting. */
export function createGateway({ manifestPath, baseUrl, onError = console.error, onWarning = console.warn, probeTimeoutMs = 2000 }) {
  if (!['http:', 'https:'].includes(new URL(baseUrl).protocol)) throw Error('Base stand must be an HTTP(S) Caddy URL')
  const readManifest = () => readDevGatewayManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), onWarning)
  const forward = (req, downstream, head) => {
    let target
    try {
      const manifest = readManifest()
      target = new URL(targetFor(manifest, req.url, baseUrl))
    } catch (error) {
      onError(error)
      if (head !== undefined) downstream.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      else { downstream.writeHead(503); downstream.end('invalid_dev_stand_manifest') }
      return
    }
    const headers = { ...req.headers, host: target.host, 'x-forwarded-host': req.headers.host,
      'x-forwarded-proto': 'http', 'x-forwarded-for': req.socket.remoteAddress }
    // A page served by the gateway is same-origin with the gateway, but the upstream only sees its
    // own host. Present such requests with the upstream origin; foreign origins pass unchanged.
    if (req.headers.origin === 'http://' + req.headers.host) headers.origin = target.origin
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
  const server = http.createServer(async (req, res) => {
    if (new URL(req.url, 'http://gateway').pathname !== DEV_GATEWAY_HEALTH_PATH) return forward(req, res)
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET' }); res.end(JSON.stringify({ error: 'method_not_allowed' })); return
    }
    try {
      const manifest = readManifest()
      const components = Object.fromEntries(await Promise.all(Object.entries(DEV_COMPONENT_REGISTRY).map(async ([id, entry]) => {
        const component = manifest.components[id]
        const target = new URL(component.source === 'dev' && component.url ? component.url : baseUrl)
        target.pathname = target.pathname.replace(/\/$/, '') + entry.readinessPath
        target.search = ''
        return [id, await probeUpstream(target, probeTimeoutMs)]
      })))
      res.end(JSON.stringify({ version: DEV_GATEWAY_VERSION, standId: manifest.standId, components }))
    } catch (error) {
      onError(error)
      res.writeHead(503); res.end(JSON.stringify({ error: 'invalid_dev_stand_manifest' }))
    }
  })
  server.on('upgrade', (req, socket, head) => forward(req, socket, head))
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--version')) { console.log(DEV_GATEWAY_VERSION); process.exit(0) }
  const { SISLEXA_STAND_MANIFEST, SISLEXA_BASE_STAND_URL, SISLEXA_GATEWAY_PORT, SISLEXA_GATEWAY_HOST = '0.0.0.0' } = process.env
  const port = Number(SISLEXA_GATEWAY_PORT)
  if (!SISLEXA_STAND_MANIFEST || !SISLEXA_BASE_STAND_URL || !Number.isInteger(port) || port < 1 || port > 65535)
    throw Error('Set SISLEXA_STAND_MANIFEST, SISLEXA_BASE_STAND_URL and allocated SISLEXA_GATEWAY_PORT')
  const server = createGateway({ manifestPath: SISLEXA_STAND_MANIFEST, baseUrl: SISLEXA_BASE_STAND_URL })
  server.listen(port, SISLEXA_GATEWAY_HOST)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
}
