import { createServer } from 'node:http'
export async function startReaderDialogsFixture() {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(
      `<!doctype html><title>Диалоги сайта</title><style>body{font:18px system-ui;padding:20px}button{margin:8px;padding:10px}output{display:block;margin-top:20px}</style><h1>Ответы на диалоги</h1><button id="alert" onclick="alert('Сообщение сайта');result.textContent='alert completed'">Показать сообщение</button><button id="confirm" onclick="result.textContent='confirm:'+confirm('Подтвердить действие?')">Подтвердить действие</button><button id="prompt" onclick="result.textContent='prompt:'+prompt('Название документа','Черновик')">Задать название</button><button id="chain" onclick="result.textContent=confirm('Продолжить?')?'chain:'+prompt('Имя','Новое'):'cancelled'">Два диалога</button><button id="guard" onclick="window.onbeforeunload=e=>{e.preventDefault();e.returnValue=''};result.textContent='guard enabled'">Защитить черновик</button><output id="result">Ready</output>${request.url === '/initial' ? '<script>alert("Начальное сообщение")</script>' : ''}`
    )
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Dialog fixture port')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())))
    }
  }
}
