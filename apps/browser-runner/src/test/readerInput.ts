import { createServer } from 'node:http'
export async function startReaderInputFixture() {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(
      `<!doctype html><title>Ввод в Reader</title><style>body{margin:0;font:16px system-ui}#field{position:absolute;left:20px;top:20px;width:200px}#second{position:absolute;left:20px;top:70px;width:200px}#button{position:absolute;left:300px;top:20px;padding:10px}#pane{position:absolute;left:300px;top:200px;width:300px;height:200px;overflow:auto;border:1px solid}#inside{width:1200px;height:1200px;background:linear-gradient(45deg,#cde,#def)}#result{position:absolute;left:20px;top:115px}#frame{position:absolute;left:20px;top:450px;width:640px;height:440px}#message{position:absolute;left:650px;top:20px;width:350px;height:140px}</style><input id="field" aria-label="Первое поле" value="abc"><input id="second" aria-label="Второе поле"><button id="button">Нажать</button><output id="result">Событий нет</output><textarea id="message" aria-label="Текст письма"></textarea><div id="pane"><div id="inside">Прокрутка в обе стороны</div></div>${request.url === '/child' ? '' : '<iframe id="frame" src="/child"></iframe>'}<script>window.events=[];for(const type of ['mousedown','mouseup','click','dblclick','keydown'])document.addEventListener(type,e=>{events.push({type:e.type,x:e.clientX,y:e.clientY,detail:e.detail,key:e.key,shift:e.shiftKey,ctrl:e.ctrlKey,meta:e.metaKey});document.getElementById('result').textContent='Клики: '+events.filter(e=>e.type==='click').length+'; двойные: '+events.filter(e=>e.type==='dblclick').length});document.getElementById('pane').onscroll=e=>document.getElementById('result').textContent='Прокрутка: '+e.target.scrollLeft+', '+e.target.scrollTop;</script>`
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Reader input port unavailable')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  }
}
