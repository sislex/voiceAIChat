// Форма и содержимое проверяются одним стендом в Chromium и через MCP.
export function readingFixtureHtml(): string {
  return `<!doctype html><meta charset="utf-8"><title>Чтение Reader</title>
    <style>body{font:18px sans-serif;margin:24px}label{display:block;margin:8px 0}table{border-collapse:collapse}th,td{border:1px solid;padding:8px}iframe{width:360px;height:100px}</style>
    <h1>Почта</h1><h2>Входящие</h2><a href="/next">Открыть письмо</a>
    <label>Тема <input id="subject" name="subject" value="Тема письма"></label>
    <label>Пароль <input id="secret" type="password" value="fixture-password"></label>
    <label>Сообщение <textarea id="message">Исходный текст</textarea></label>
    <label>Язык <select id="language"><option value="ru">Русский</option><option value="en">English</option></select></label>
    <button id="quoted" data-testid='next&quot;quoted&#92;path'>Next &gt;&gt; literal</button><output id="click-result">нет клика</output>
    <button aria-label='Закрыть &quot;окно&quot; &#92; путь' id="labelled">×</button>
    <div hidden class="choice">Скрыто</div><button class="choice">Видимо</button><button class="choice">Ещё</button>
    <table id="messages"><caption>Входящие письма</caption><thead><tr><th>Отправитель</th><th>Тема</th></tr></thead><tbody><tr><td>Команда</td><td>Привет</td></tr></tbody></table>
    <iframe id="preview" title="Превью письма" name="preview" src="/next"></iframe>
    <section id="long">${'0123456789'.repeat(600)}</section>
    <script>document.getElementById('quoted').onclick=()=>document.getElementById('click-result').textContent='нажато';</script>`
}
