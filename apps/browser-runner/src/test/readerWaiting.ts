export function waitingFixtureHtml(): string {
  return `<!doctype html><meta charset="utf-8"><title>Ожидания Reader</title>
    <style>body{font:18px sans-serif;margin:24px}label{display:block;margin:12px 0}</style>
    <h1>Готовность страницы</h1><p id="status">Загрузка</p><div id="spinner">Пожалуйста, подождите</div>
    <button id="send" disabled>Отправить</button>
    <label>Сообщение <input id="field" readonly value="старое"></label>
    <label><input id="check" type="checkbox"> Данные получены</label>
    <div id="rows"><p class="row">Первая строка</p></div>
    <button id="begin">Загрузить данные</button>
    <button id="clear">Очистить список</button>
    <script>
      window.appReady=false;
      document.getElementById('clear').onclick=()=>{
        document.getElementById('spinner')?.remove();document.getElementById('rows').replaceChildren();
      };
      document.getElementById('begin').onclick=()=>setTimeout(()=>{
        document.getElementById('status').textContent='Готово';
        document.getElementById('spinner').hidden=true;
        document.getElementById('send').disabled=false;
        document.getElementById('field').readOnly=false;
        document.getElementById('field').value='готово';
        document.getElementById('check').checked=true;
        document.getElementById('rows').insertAdjacentHTML('beforeend','<p class="row">Вторая строка</p>');
        window.appReady=true;history.replaceState(null,'','#ready');
      },300);
    </script>`
}
