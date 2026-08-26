// Make — инструмент «собери веб-приложение с ассистентом» (аналог Figma Make):
// слева чат, справа панель проекта с превью и редактором кода. Проект — рабочая
// папка разговора на сервере (`<dataDir>/make/<conversationId>/`) со статическими
// файлами (index.html + css + js, без сборки): их пишут и ассистент (MCP-инструменты
// mcp__make__*), и пользователь (редактор). Превью — same-origin iframe поверх
// `/api/preview/make/<conversationId>/…` (та же preview-cookie, что у Web Reader).
// Здесь — чистый контракт: типы, лимиты и валидация путей, общая для сервера и UI.

/** Вид разговора Make (см. `AssistantKind`). */
export const MAKE_KIND = 'make' as const

/** Метаданные файла проекта (без содержимого). */
export interface MakeFileInfo {
  /** Нормализованный путь относительно корня проекта: `index.html`, `css/app.css`. */
  path: string
  size: number
  /** UNIX-мс последней записи. */
  updatedAt: number
}

/** Содержимое текстового файла проекта. */
export interface MakeFileContent extends MakeFileInfo {
  content: string
}

/** Снимок проекта (ревизия): полная копия файлов на момент создания. */
export interface MakeSnapshot {
  id: string
  createdAt: number
  /** Подпись: кто и зачем сохранил (например, «перед правкой ассистента»). */
  label: string
  files: number
}

/** Публикация проекта: непубличная ссылка без авторизации (как «Publish» в Figma Make). */
export interface MakePublication {
  /** Случайный токен в URL — знание ссылки и есть доступ. */
  token: string
  publishedAt: number
  /** Относительный URL страницы публикации (`/p/<token>/`). */
  url: string
}

/** Замечание статической проверки проекта (битые ссылки, отсутствующие файлы…). */
export interface MakeCheckIssue {
  /** Файл, где найдено. */
  path: string
  kind: 'missing-file' | 'no-index' | 'external-script' | 'empty-file'
  message: string
}

/** Состояние проекта для панели: список файлов, ревизии и счётчик изменений. */
export interface MakeProjectState {
  conversationId: string
  files: MakeFileInfo[]
  snapshots: MakeSnapshot[]
  /** Монотонный номер изменения — UI перезагружает превью, когда он растёт. */
  rev: number
  published: MakePublication | null
}

/** Публичный префикс публикаций: маршрут вне `/api/`, поэтому без Bearer/cookie. */
export const MAKE_PUBLIC_PREFIX = '/p/'
export const makePublicUrl = (token: string): string => `${MAKE_PUBLIC_PREFIX}${encodeURIComponent(token)}/`

export const MAKE_LIMITS = {
  /** Максимальный размер одного файла (байты). */
  maxFileBytes: 2 * 1024 * 1024,
  /** Максимум файлов в проекте. */
  maxFiles: 400,
  /** Максимум хранимых снимков; старые удаляются. */
  maxSnapshots: 50,
  /** Максимальная глубина вложенности каталогов. */
  maxDepth: 8
} as const

/** Расширения, которые панель считает текстом и открывает в редакторе. */
export const MAKE_TEXT_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'json', 'md', 'txt', 'svg', 'xml', 'csv', 'yml', 'yaml', 'webmanifest'
])

/** MIME по расширению — для отдачи превью и для подсветки в редакторе. */
export function makeMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const table: Record<string, string> = {
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    ico: 'image/x-icon', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', xml: 'application/xml',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', webmanifest: 'application/manifest+json', mp3: 'audio/mpeg', wav: 'audio/wav'
  }
  return table[ext] ?? 'application/octet-stream'
}

export function isMakeTextPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return MAKE_TEXT_EXTENSIONS.has(ext)
}

/** Символы, недопустимые в имени файла проекта: управляющие и спецсимволы Windows/URL. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f:*?"<>|]/

/**
 * Нормализует путь файла проекта или возвращает null, если он недопустим:
 * абсолютный, с `..`, скрытыми сегментами (`.snapshots` — служебный каталог),
 * пустыми сегментами, управляющими символами или слишком глубокий. Разделитель —
 * всегда `/`; ведущий `./` и `/` срезаются. Пробелы внутри имён разрешены.
 */
export function normalizeMakePath(input: string): string | null {
  if (typeof input !== 'string') return null
  let p = input.trim().replace(/\\/g, '/')
  if (!p) return null
  p = p.replace(/^(\.\/)+/, '').replace(/^\/+/, '')
  if (!p || p.endsWith('/')) return null
  const parts = p.split('/')
  if (parts.length > MAKE_LIMITS.maxDepth) return null
  for (const part of parts) {
    if (!part || part === '.' || part === '..') return null
    if (part.startsWith('.')) return null
    if (FORBIDDEN_CHARS.test(part)) return null
    if (part.length > 120) return null
  }
  return parts.join('/')
}

/** Стартовый проект нового разговора Make: пустая страница-заготовка. */
export const MAKE_SCAFFOLD: Record<string, string> = {
  'index.html': `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Новый проект</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="hero">
    <h1>Новый проект</h1>
    <p>Опишите ассистенту слева, что нужно сделать — он создаст и изменит файлы, а превью обновится само.</p>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
  'styles.css': `:root { color-scheme: light dark; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f7f9; color: #1c1f26; }
.hero { max-width: 520px; padding: 32px; text-align: center; }
h1 { margin: 0 0 12px; font-size: 32px; }
p { margin: 0; line-height: 1.5; color: #5b6170; }
`,
  'app.js': `// Точка входа проекта. Ассистент дописывает поведение сюда или в новые файлы.
console.log('Make: проект загружен');
`
}

/** Шаблон проекта: набор файлов, с которого удобно начинать вместо пустой заготовки. */
export interface MakeTemplate {
  id: string
  title: string
  description: string
  files: Record<string, string>
}

const TEMPLATE_CSS_BASE = `:root { color-scheme: light; --bg: #f6f7f9; --fg: #1c1f26; --muted: #5b6170; --accent: #2f6df6; --card: #fff; --line: #e3e6ec; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); line-height: 1.5; }
.container { width: min(1100px, 92vw); margin: 0 auto; }
`

export const MAKE_TEMPLATES: readonly MakeTemplate[] = [
  { id: 'blank', title: 'Пустая страница', description: 'Стартовая заготовка: index.html, styles.css, app.js.', files: MAKE_SCAFFOLD },
  {
    id: 'landing',
    title: 'Лендинг',
    description: 'Шапка с меню, герой-блок, три карточки преимуществ, форма и подвал.',
    files: {
      'index.html': `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Продукт — лендинг</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="topbar"><div class="container topbar__in"><a class="brand" href="#">Продукт</a><nav class="menu"><a href="#features">Возможности</a><a href="#pricing">Цены</a><a href="#contact">Контакты</a></nav></div></header>
  <section class="hero"><div class="container"><h1>Заголовок, который продаёт</h1><p class="lead">Одно предложение о том, какую проблему решает продукт и для кого.</p><a class="btn" href="#contact">Попробовать бесплатно</a></div></section>
  <section id="features" class="features container">
    <article class="card"><h3>Быстро</h3><p>Короткое описание преимущества.</p></article>
    <article class="card"><h3>Надёжно</h3><p>Короткое описание преимущества.</p></article>
    <article class="card"><h3>Просто</h3><p>Короткое описание преимущества.</p></article>
  </section>
  <section id="contact" class="contact container"><h2>Оставьте заявку</h2><form class="form" id="lead-form"><input type="text" name="name" placeholder="Имя" required><input type="email" name="email" placeholder="Почта" required><button class="btn" type="submit">Отправить</button></form><p class="form__note" id="form-note" hidden>Спасибо! Мы свяжемся с вами.</p></section>
  <footer class="footer"><div class="container">© Продукт, 2026</div></footer>
  <script src="app.js"></script>
</body>
</html>
`,
      'styles.css': TEMPLATE_CSS_BASE + `.topbar { background: var(--card); border-bottom: 1px solid var(--line); }
.topbar__in { display: flex; align-items: center; justify-content: space-between; height: 60px; }
.brand { font-weight: 800; text-decoration: none; color: var(--fg); }
.menu a { margin-left: 20px; color: var(--muted); text-decoration: none; }
.hero { padding: 80px 0; text-align: center; }
.hero h1 { font-size: clamp(32px, 5vw, 52px); margin: 0 0 12px; }
.lead { color: var(--muted); font-size: 18px; max-width: 560px; margin: 0 auto 24px; }
.btn { display: inline-block; background: var(--accent); color: #fff; padding: 12px 22px; border-radius: 10px; text-decoration: none; border: 0; font: inherit; cursor: pointer; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; padding: 20px 0 60px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 22px; }
.contact { padding: 40px 0 80px; text-align: center; }
.form { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.form input { padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; font: inherit; min-width: 220px; }
.footer { border-top: 1px solid var(--line); padding: 24px 0; color: var(--muted); text-align: center; }
`,
      'app.js': `document.getElementById('lead-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  event.currentTarget.hidden = true;
  document.getElementById('form-note').hidden = false;
});
`
    }
  },
  {
    id: 'dashboard',
    title: 'Дашборд',
    description: 'Боковое меню, карточки метрик, таблица и простая диаграмма на SVG.',
    files: {
      'index.html': `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Дашборд</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body class="layout">
  <aside class="side"><div class="brand">Панель</div><nav><a class="active" href="#">Обзор</a><a href="#">Заказы</a><a href="#">Клиенты</a><a href="#">Настройки</a></nav></aside>
  <main class="main">
    <h1>Обзор</h1>
    <section class="kpis" id="kpis"></section>
    <section class="panel"><h2>Продажи за неделю</h2><svg id="chart" viewBox="0 0 700 220" role="img" aria-label="Диаграмма продаж"></svg></section>
    <section class="panel"><h2>Последние заказы</h2><table class="table"><thead><tr><th>№</th><th>Клиент</th><th>Сумма</th><th>Статус</th></tr></thead><tbody id="orders"></tbody></table></section>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
      'styles.css': TEMPLATE_CSS_BASE + `.layout { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
.side { background: #141821; color: #dfe4ee; padding: 20px 14px; }
.side .brand { font-weight: 800; margin-bottom: 20px; }
.side nav a { display: block; padding: 10px 12px; border-radius: 8px; color: inherit; text-decoration: none; }
.side nav a.active, .side nav a:hover { background: rgba(255,255,255,.1); }
.main { padding: 28px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 20px; }
.kpi { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
.kpi b { display: block; font-size: 26px; }
.kpi span { color: var(--muted); font-size: 13px; }
.panel { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px; margin-bottom: 20px; }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); }
.status { padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #e8f3ff; color: #1f5fd0; }
@media (max-width: 720px) { .layout { grid-template-columns: 1fr; } .side { display: flex; gap: 8px; align-items: center; } .side nav { display: flex; gap: 4px; } }
`,
      'app.js': `const kpis = [['Выручка', '1 240 000 ₽'], ['Заказы', '318'], ['Средний чек', '3 900 ₽'], ['Конверсия', '4.2%']];
document.getElementById('kpis').innerHTML = kpis.map(([label, value]) => '<div class="kpi"><b>' + value + '</b><span>' + label + '</span></div>').join('');
const sales = [42, 58, 51, 77, 69, 90, 84];
const chart = document.getElementById('chart');
const max = Math.max(...sales);
chart.innerHTML = sales.map((v, i) => { const h = Math.round((v / max) * 170); const x = 30 + i * 95; return '<rect x="' + x + '" y="' + (200 - h) + '" width="60" height="' + h + '" rx="6" fill="#2f6df6"></rect><text x="' + (x + 30) + '" y="215" text-anchor="middle" font-size="12" fill="#5b6170">' + ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][i] + '</text>'; }).join('');
const orders = [[1041, 'Анна К.', '5 200 ₽', 'Оплачен'], [1040, 'ООО «Ромашка»', '48 000 ₽', 'В доставке'], [1039, 'Игорь П.', '1 350 ₽', 'Оплачен'], [1038, 'Мария С.', '2 990 ₽', 'Возврат']];
document.getElementById('orders').innerHTML = orders.map((row) => '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td><td>' + row[2] + '</td><td><span class="status">' + row[3] + '</span></td></tr>').join('');
`
    }
  }
]
