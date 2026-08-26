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

/** Состояние проекта для панели: список файлов, ревизии и счётчик изменений. */
export interface MakeProjectState {
  conversationId: string
  files: MakeFileInfo[]
  snapshots: MakeSnapshot[]
  /** Монотонный номер изменения — UI перезагружает превью, когда он растёт. */
  rev: number
}

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
