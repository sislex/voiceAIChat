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
/** Совпадение поиска по содержимому файлов проекта. */
export interface MakeSearchMatch {
  path: string
  /** Номер строки с 1. */
  line: number
  /** Строка целиком, обрезана до 200 символов. */
  text: string
}

/** Файл `*.stories.(jsx|tsx)` и имена его стори (именованные экспорты). */
export interface MakeStoryFile {
  path: string
  /** `title` из default-экспорта или имя файла без суффикса. */
  title: string
  stories: string[]
}

/** Файлы, которые сервер транспилирует esbuild при отдаче превью (JSX/TS → ESM). */
export const MAKE_TRANSPILED_EXTENSIONS = new Set(['jsx', 'tsx', 'ts'])
export const isMakeTranspiledPath = (path: string): boolean => MAKE_TRANSPILED_EXTENSIONS.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase())
export const isMakeStoriesPath = (path: string): boolean => /\.stories\.(jsx|tsx)$/i.test(path)

/** Страница-раннер сториз внутри превью проекта: `?file=<stories>&story=<name>`. */
export const MAKE_STORIES_PAGE = '__stories__'

/** Import map по умолчанию для React-проектов: React из esm.sh, версии закреплены. */
export const MAKE_REACT_IMPORT_MAP: Record<string, string> = {
  react: 'https://esm.sh/react@18.3.1',
  'react/jsx-runtime': 'https://esm.sh/react@18.3.1/jsx-runtime',
  'react-dom': 'https://esm.sh/react-dom@18.3.1?deps=react@18.3.1',
  'react-dom/client': 'https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1'
}

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
    js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', jsx: 'text/javascript; charset=utf-8', tsx: 'text/javascript; charset=utf-8', ts: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
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
  ,{
    id: 'react',
    title: 'React-приложение + Storybook',
    description: 'React 18 из esm.sh без сборки: JSX транспилируется на сервере. Компоненты в src/components, сториз рядом (*.stories.jsx) — вкладка «Компоненты».',
    files: {
      'index.html': `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>React-приложение</title>
  <link rel="stylesheet" href="styles.css">
  <script type="importmap">${JSON.stringify({ imports: MAKE_REACT_IMPORT_MAP }, null, 2)}</script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="src/main.jsx"></script>
</body>
</html>
`,
      'styles.css': `:root { --bg: #f6f7fb; --fg: #1a1d23; --accent: #4f7cff; --card: #fff; font-family: system-ui, sans-serif; }
body { margin: 0; background: var(--bg); color: var(--fg); }
.app { max-width: 720px; margin: 0 auto; padding: 32px 20px; display: grid; gap: 20px; }
.card { background: var(--card); border-radius: 12px; padding: 20px; box-shadow: 0 1px 4px rgb(0 0 0 / .08); }
.btn { border: 0; border-radius: 8px; padding: 10px 16px; font: inherit; cursor: pointer; background: var(--accent); color: #fff; }
.btn--secondary { background: #e7eaf3; color: var(--fg); }
.btn--sm { padding: 6px 10px; font-size: 13px; }
.counter { display: flex; align-items: center; gap: 12px; }
`,
      'src/main.jsx': `import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'

createRoot(document.getElementById('root')).render(<App />)
`,
      'src/App.jsx': `import { useState } from 'react'
import { Button } from './components/Button.jsx'
import { Card } from './components/Card.jsx'

export function App() {
  const [count, setCount] = useState(0)
  return (
    <main className="app">
      <Card title="Счётчик">
        <div className="counter">
          <Button onClick={() => setCount((c) => c - 1)} variant="secondary">−</Button>
          <strong>{count}</strong>
          <Button onClick={() => setCount((c) => c + 1)}>+</Button>
        </div>
      </Card>
      <Card title="Как это устроено">
        <p>React загружается из esm.sh, JSX превращается в JS на сервере при отдаче файла. Компоненты — в <code>src/components</code>, их сториз — во вкладке «Компоненты».</p>
      </Card>
    </main>
  )
}
`,
      'src/components/Button.jsx': `export function Button({ children, variant = 'primary', size = 'md', ...rest }) {
  const cls = ['btn', variant === 'secondary' && 'btn--secondary', size === 'sm' && 'btn--sm'].filter(Boolean).join(' ')
  return <button type="button" className={cls} {...rest}>{children}</button>
}
`,
      'src/components/Button.stories.jsx': `import { Button } from './Button.jsx'

export default { title: 'Button', component: Button, args: { children: 'Кнопка', variant: 'primary', size: 'md' } }

export const Primary = {}
export const Secondary = { args: { variant: 'secondary' } }
export const Small = { args: { size: 'sm', children: 'Маленькая' } }
`,
      'src/components/Card.jsx': `export function Card({ title, children }) {
  return (
    <section className="card">
      {title && <h2 style={{ marginTop: 0 }}>{title}</h2>}
      {children}
    </section>
  )
}
`,
      'src/components/Card.stories.jsx': `import { Card } from './Card.jsx'

export default { title: 'Card', component: Card, args: { title: 'Заголовок', children: 'Содержимое карточки' } }

export const Default = {}
export const WithoutTitle = { args: { title: undefined } }
`
    }
  }

]

/** Стартовый промпт — как «идеи» на главной Figma Make: клик вставляет текст в композер. */
export interface MakeStarterPrompt {
  id: string
  /** Короткий заголовок карточки. */
  title: string
  /** Полный промпт для ассистента. */
  prompt: string
  /** Группа для фильтра в диалоге. */
  group: 'site' | 'app' | 'react' | 'tool'
}

export const MAKE_STARTER_GROUPS: Record<MakeStarterPrompt['group'], string> = {
  site: 'Сайты и лендинги',
  app: 'Приложения и дашборды',
  react: 'React и компоненты',
  tool: 'Инструменты и игры'
}

export const MAKE_STARTER_PROMPTS: readonly MakeStarterPrompt[] = [
  { id: 'landing-saas', group: 'site', title: 'Лендинг SaaS-продукта', prompt: 'Сделай лендинг для SaaS-продукта по управлению задачами команды: герой-блок с заголовком и CTA, три преимущества с иконками, секция «как это работает» из трёх шагов, тарифы (3 плана, переключатель месяц/год), FAQ-аккордеон и подвал. Современный светлый стиль, адаптивно.' },
  { id: 'portfolio', group: 'site', title: 'Портфолио дизайнера', prompt: 'Создай сайт-портфолио продуктового дизайнера: имя и короткое био, сетка из 6 проектов с обложками (inline SVG-заглушки), страница-модалка с деталями проекта, блок «обо мне» и контакты. Минимализм, много воздуха, тёмная тема.' },
  { id: 'restaurant', group: 'site', title: 'Сайт ресторана с меню', prompt: 'Сделай сайт небольшого ресторана: шапка с навигацией, герой с фото-заглушкой и кнопкой «Забронировать», меню по категориям с табами, галерея, форма бронирования с валидацией и карта-заглушка в контактах. Тёплая палитра.' },
  { id: 'event', group: 'site', title: 'Страница мероприятия', prompt: 'Создай страницу конференции: дата и место, обратный отсчёт до начала (JS), программа по трекам с расписанием, спикеры карточками, форма регистрации и блок партнёров. Яркий акцентный цвет, адаптивно.' },
  { id: 'dashboard', group: 'app', title: 'Аналитический дашборд', prompt: 'Сделай дашборд продаж: боковое меню, карточки метрик (выручка, заказы, конверсия, средний чек) с трендом, линейный график по месяцам и столбчатый по категориям на чистом SVG, таблица последних заказов с сортировкой и поиском, переключатель тёмной темы.' },
  { id: 'kanban', group: 'app', title: 'Канбан-доска задач', prompt: 'Создай канбан-доску: три колонки (Сделать, В работе, Готово), добавление/редактирование/удаление карточек, перетаскивание между колонками мышью и пальцем, фильтр по метке, сохранение в localStorage. Аккуратный UI.' },
  { id: 'habits', group: 'app', title: 'Трекер привычек', prompt: 'Сделай трекер привычек: список привычек с отметками по дням недели, серия (streak), прогресс за месяц в виде тепловой карты, добавление и удаление привычек, данные в localStorage, мобильный дизайн в первую очередь.' },
  { id: 'crm', group: 'app', title: 'Мини-CRM контактов', prompt: 'Создай мини-CRM: таблица контактов с поиском, фильтром по статусу и сортировкой, боковая панель с карточкой контакта и заметками, форма добавления, экспорт в CSV, данные в localStorage.' },
  { id: 'react-app', group: 'react', title: 'React-приложение с компонентами', prompt: 'Примени подход React-проекта (index.html с import map на esm.sh, src/main.jsx, компоненты в src/components с файлами *.stories.jsx). Сделай приложение «список покупок»: добавление, отметка, удаление, фильтр, счётчик; компоненты Button, Input, ListItem, EmptyState — каждый со сториз для основных состояний.' },
  { id: 'react-ui-kit', group: 'react', title: 'UI-кит из 6 компонентов', prompt: 'Сделай React UI-кит без сборки (import map на esm.sh, JSX в src/components): Button (варианты primary/secondary/danger, размеры sm/md/lg, disabled, loading), Input с подписью и ошибкой, Badge, Card, Toggle, Modal. Для каждого — файл *.stories.jsx со всеми состояниями. Единая палитра через CSS-переменные.' },
  { id: 'react-form', group: 'react', title: 'Многошаговая форма на React', prompt: 'Создай React-приложение с многошаговой формой заявки (3 шага: контакты, детали, подтверждение): валидация полей, индикатор шагов, сохранение черновика в localStorage, итоговый экран. Компоненты Stepper, Field, Summary со сториз.' },
  { id: 'calculator', group: 'tool', title: 'Калькулятор ипотеки', prompt: 'Сделай калькулятор ипотеки: сумма, срок, ставка, первоначальный взнос — ползунки и поля; результат: ежемесячный платёж, переплата, график платежей таблицей и диаграмма доли процентов на SVG. Пересчёт на лету.' },
  { id: 'quiz', group: 'tool', title: 'Квиз с результатом', prompt: 'Создай квиз из 8 вопросов с вариантами ответов, прогресс-баром, таймером на вопрос, подсчётом баллов и экраном результата с кнопкой «Поделиться» (копирует текст). Вопросы — в отдельном JSON-файле.' },
  { id: 'game-2048', group: 'tool', title: 'Игра 2048', prompt: 'Сделай игру 2048: поле 4×4, управление стрелками и свайпами, анимация плиток, счёт и лучший результат в localStorage, кнопка «Новая игра», экран победы/поражения. Аккуратная типографика.' },
  { id: 'markdown', group: 'tool', title: 'Markdown-редактор', prompt: 'Создай Markdown-редактор с живым превью в две колонки: свой простой парсер (заголовки, списки, жирный/курсив, ссылки, код), панель инструментов, счётчик слов, автосохранение в localStorage и экспорт в .md.' }
]
