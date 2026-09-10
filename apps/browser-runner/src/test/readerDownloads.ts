import { createServer } from 'node:http'
export async function startReaderDownloadsFixture() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture')
    if (url.pathname === '/file') {
      response.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': "attachment; filename*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82.txt"
      })
      response.end('Начало 😀\n' + 'Строка отчёта\n'.repeat(2200) + 'Конец')
    } else if (url.pathname === '/binary') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename=data.bin'
      })
      response.end(Buffer.from([0, 255, 1, 2, 3, 128]))
    } else if (url.pathname === '/slow') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename=slow.bin'
      })
      response.write(Buffer.alloc(1024))
      const timer = setInterval(() => response.write(Buffer.alloc(1024)), 50)
      response.on('close', () => clearInterval(timer))
    } else {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(
        `<!doctype html><title>Скачивание файлов</title><style>body{font:18px system-ui;padding:24px}a,button{margin:12px;display:inline-block}output{display:block}</style><h1>Экспорт и вложения</h1><a id="file" href="/file">Скачать отчёт</a><a id="binary" href="/binary">Скачать вложение</a><a id="slow" href="/slow">Большой файл</a><button id="blob" onclick="const a=document.createElement('a');a.href=window.URL.createObjectURL(new Blob(['Данные из проекта 😀'],{type:'text/plain'}));a.download='export.txt';a.click()">Экспорт проекта</button><output>Страница остаётся открытой</output>`
      )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture port')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  }
}
