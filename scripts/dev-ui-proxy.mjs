// Keep the familiar development URL while Core serves the pinned UI artifact.
import http from 'node:http'
import net from 'node:net'
const apiPort = Number(process.env.VC_API_PORT || 8787)
const webPort = Number(process.env.VC_WEB_PORT || 5273)
for (const port of [apiPort, webPort]) if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid development port')
const server = http.createServer((request, response) => {
  const upstream = http.request({ host: '127.0.0.1', port: apiPort, path: request.url, method: request.method, headers: request.headers }, reply => {
    response.writeHead(reply.statusCode || 502, reply.headers); reply.pipe(response)
  })
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('Core is unavailable') })
  response.on('close', () => upstream.destroy())
  request.pipe(upstream)
})
server.on('upgrade', (request, socket, head) => {
  const upstream = net.connect(apiPort, '127.0.0.1', () => {
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n` + request.rawHeaders.reduce((text, value, index, all) => index % 2 ? text : text + value + ': ' + all[index + 1] + '\r\n', '') + '\r\n')
    if (head.length) upstream.write(head)
    socket.pipe(upstream); upstream.pipe(socket)
  })
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy())
  socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy())
})
server.listen(webPort, '127.0.0.1', () => console.log(`[core-ui] http://127.0.0.1:${webPort} → Core :${apiPort}`))
