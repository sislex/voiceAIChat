// Общий браузерный стенд раннера и E2E: события и выбранные файлы наблюдаемы
// снаружи через текст страницы, без подмены Playwright-локаторов.
import { createServer } from 'node:http'
import { readingFixtureHtml } from './readerReading.js'

export async function startReaderFormsFixture() {
  const app = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/reading') { res.end(readingFixtureHtml()); return }
    if (req.url === '/next') { res.end('<!doctype html><title>Следующая страница</title><h1>Переход завершён</h1>'); return }
    if (req.url === '/capture') {
      res.end('<!doctype html><title>Проверка снимков</title><style>body{margin:0;height:1800px;font:18px sans-serif}#tile{position:absolute;left:40px;top:900px;width:160px;height:90px;background:#176b37;color:white}</style><h1>Снимок всей страницы</h1><div id="tile">Снимок области</div>')
      return
    }
    res.end(`<!doctype html><meta charset="utf-8"><title>Формы Reader</title>
      <style>body { font: 18px sans-serif; margin: 24px } label,output {display:block;margin:8px 0} #scroller {height:80px;width:300px;overflow:auto;border:1px solid} #inner {height:30000px} #tall {height:30000px}</style>
      <h1>Формы Reader</h1>
      <button id="popup" onclick="window.open('/next')">Вход в новом окне</button>
      <div id="drag-source" style="position:absolute;right:20px;top:20px;width:120px;height:80px;background:#cfe2cc">Перетащить</div><output id="drag-result">нет движения</output>
      <button id="modifiers">Проверить модификаторы</button><output id="modifiers-result">нет клика</output>
      <label>Цель клавиши <input id="target"></label><label>Другое поле <input id="other"></label><output id="key-result">нет клавиши</output>
      <label>Язык <select id="language"><option value="en">English</option><option value="ru">Русский</option></select></label><output id="select-result">en</output>
      <label>Громкость <input id="range" type="range" min="0" max="100" step="5" value="0"></label><output id="range-result">range:0</output>
      <label>Файл <input id="file" type="file"></label><output id="file-result">нет файла</output>
      <div id="scroller"><div id="inner">Вложенная область</div></div><output id="scroll-result">inner:0</output>
      <a id="next" href="/next">Следующая страница</a><div id="tall">Длинная страница</div><p>Конец страницы</p>
      <script>
      const el = id => document.getElementById(id);
      let dragStart = null;
      el('drag-source').onpointerdown = event => { dragStart = {x:event.clientX,y:event.clientY} };
      window.addEventListener('pointerup',event => { if (dragStart && Math.hypot(event.clientX-dragStart.x,event.clientY-dragStart.y)>100) el('drag-result').textContent='перенесено'; dragStart=null });
      el('modifiers').onmousedown = event => { el('modifiers-result').textContent = JSON.stringify({ctrl:event.ctrlKey,shift:event.shiftKey,alt:event.altKey,meta:event.metaKey}) };
      for (const id of ['target','other']) el(id).onkeydown = event => { el('key-result').textContent = id + ':' + event.key };
      el('language').onchange = event => { el('select-result').textContent = event.target.value };
      const rangeEvents = [];
      for (const name of ['input','change']) el('range').addEventListener(name,event => { rangeEvents.push(event.type); el('range-result').textContent = 'range:' + event.target.value + ' ' + rangeEvents.join(' ') });
      el('file').onchange = event => { const file = event.target.files[0]; el('file-result').textContent = file ? 'file:' + file.name + ':' + file.size : 'нет файла' };
      el('scroller').onscroll = event => { el('scroll-result').textContent = 'inner:' + event.target.scrollTop };
      </script>`)
  })
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  const address = app.address()
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => { app.closeAllConnections(); await new Promise<void>(resolve => app.close(() => resolve())) }
  }
}
