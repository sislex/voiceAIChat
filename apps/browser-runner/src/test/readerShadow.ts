// Стенд повторяет компоненты с Shadow DOM, слоты и одинаковые подписи действий.
export const READER_SHADOW_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Компоненты Reader</title>
<style>body{font:16px sans-serif;margin:24px}button,input{padding:8px;margin:4px}#result{padding:12px;background:#def}#host{display:block;border:1px solid #bbb;padding:12px}</style></head><body>
<h1>Компоненты страницы</h1><p id="label">Подпись снаружи</p>
<div id="host"><button id="action" onclick="report('slot')">Действие из слота</button></div>
<button class="repeat" aria-label="Открыть" onclick="report('first')" onmouseenter="report('hover-first')">Первая</button>
<button class="repeat" aria-label="Открыть" onclick="report('second')" onmouseenter="report('hover-second')">Вторая</button>
<button id="deep" onclick="report('deep')"><span><span><span><span><span data-inner="deep">Глубокая кнопка</span></span></span></span></span></button>
<fieldset disabled><legend><input id="legend-input" value="доступно"></legend><input id="disabled-field" value="недоступно"></fieldset>
<p id="result" role="status">Нет действий</p>
<script>
function report(value){document.getElementById('result').textContent=value}
const root=document.getElementById('host').attachShadow({mode:'open'});
root.innerHTML='<style>button,input{padding:8px;margin:4px}.far{margin-top:1200px}</style><h2>Теневая форма</h2><slot></slot><p id="label">Внутренняя подпись</p><input id="entry" aria-labelledby="label" value="Текущее значение"><button id="action">Теневое действие</button><a href="/next">Ссылка компонента</a><table><caption>Данные компонента</caption><tr><td>Ячейка</td></tr></table><span hidden>Скрытый текст компонента</span><div id="nested"></div><button class="far">Дальняя кнопка</button>';
root.querySelector('#action').onclick=()=>report('shadow');
root.querySelector('.far').onclick=()=>report('far');
const nested=root.querySelector('#nested').attachShadow({mode:'open'});nested.innerHTML='<button id="nested-button">Вложенная кнопка</button>';
nested.querySelector('button').onclick=()=>report('nested');
</script></body></html>`
