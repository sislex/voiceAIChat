import { createServer } from 'node:http'
export async function startReaderDiagnosticsFixture() {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://site').pathname
    if (path === '/download') {
      response.writeHead(200, { 'content-disposition': 'attachment; filename=report.txt' })
      response.end('Report')
      return
    }
    if (path === '/broken') {
      request.socket.destroy()
      return
    }
    if (path === '/slow') {
      response.setHeader('content-type', 'application/json')
      const timer = setTimeout(() => response.end('{"ready":true}'), 250)
      response.on('close', () => clearTimeout(timer))
      return
    }
    if (path === '/bad') {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end('{"error":"Service unavailable"}')
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(
      `<!doctype html><title>Диагностика ${path}</title><h1>Диагностика страницы</h1><button id="network" onclick="Promise.allSettled([fetch('/bad'),fetch('/broken'),fetch('/slow')]).then(()=>document.querySelector('output').textContent='Requests finished')">Запросы</button><button id="logs" onclick="console.log('Payload',{nested:{detail:'Вложенные данные'},items:[1,2,3]});console.warn('Warning marker');console.log('literal [x]')">Логи</button><button id="error" onclick="setTimeout(()=>{throw new Error('Ошибка сценария')},0)">Исключение</button><button id="spam" onclick="for(let i=0;i<100;i++)console.error('Large'+i+':'+'.'.repeat(1900))">Большой журнал</button><output>Ready</output>`
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const a = server.address()
  if (!a || typeof a === 'string') throw new Error('Fixture port')
  return {
    origin: `http://127.0.0.1:${a.port}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  }
}
