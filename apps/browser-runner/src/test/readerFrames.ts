import { createServer, type Server } from 'node:http'

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Порт стенда недоступен')
  return `http://127.0.0.1:${address.port}`
}

export async function startReaderFramesFixture() {
  const child = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/redirect') { res.writeHead(302, { location: '/nested' }); res.end(); return }
    if (req.url === '/next') { res.end('<title>Следующий документ</title><h1>Внутренний переход</h1>'); return }
    if (req.url === '/nested') { res.end('<title>Вложенный документ</title><h1>Глубокий документ</h1><input id="field" value="nested"><button id="nested-action" onclick="document.querySelector(\'h1\').textContent=\'Глубокий клик\'">Глубокая кнопка</button>'); return }
    res.end(`<!doctype html><title>Документ компонента</title><style>body{margin:10px;font:16px sans-serif}#tile{background:rgb(20,100,180);width:120px;height:60px}#field{color:rgb(0,128,0)}#record-target{position:absolute;left:360px;top:30px;width:140px;height:30px}iframe{display:block;width:350px;height:180px}</style>
      <h1>Внутренний документ</h1><button id="record-target" onclick="document.getElementById('status').textContent='Записанный клик'">Кнопка записи</button><input id="field" value="child"><button id="child-action" onclick="document.getElementById('status').textContent='Нажато внутри'">Внутренняя кнопка</button><p id="status">Ждёт клика</p><div id="tile">Область кадра</div>
      <iframe id="nested" name="nested" src="/redirect"></iframe><a href="/next" id="next">Дальше</a><a href="/next" target="_top" id="top">Верхняя страница</a><div style="height:1000px"></div><button id="far">Нижняя кнопка</button><script>window.frameMarker='child'</script>`)
  })
  const childOrigin = await listen(child)
  const main = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><title>Страница проекта с iframe</title><style>body{margin:20px;font:16px sans-serif}#outer{width:600px;height:500px;border:4px solid #888}#field{color:rgb(255,0,0)}</style><h1>Родительский документ</h1><input id="field" value="parent"><iframe id="outer" name="preview" src="${childOrigin}/frame"></iframe><script>window.frameMarker='parent'</script>`)
  })
  const origin = await listen(main)
  return { origin, childOrigin, close: async () => { for (const server of [main, child]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } } }
}
