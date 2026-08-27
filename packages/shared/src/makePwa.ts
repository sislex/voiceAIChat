// PWA-обвязка для экспорта Make (п.35): манифест, простой service worker (cache-first для своих
// файлов, network-first для index.html) и SVG-иконка. Чистые функции над текстом — сервер только
// складывает результат в ZIP. Для Vite файлы идут в public/ (Vite копирует их в корень сборки).

export interface PwaOptions {
  title: string
  themeColor: string
  /** Vite-проект: файлы в public/, ссылки абсолютные от корня; иначе — рядом с index.html, относительные. */
  vite: boolean
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/** Название из <title>, цвет — из meta theme-color или --accent в :root; иначе дефолты. */
export function detectPwaMeta(indexHtml: string | null, css: string | null): { title: string; themeColor: string } {
  const title = indexHtml?.match(/<title>([^<]{1,80})<\/title>/i)?.[1]?.trim() || 'Проект Make'
  const meta = indexHtml?.match(/<meta\s+name=["']theme-color["']\s+content=["']([^"']+)["']/i)?.[1]
  const accent = css?.match(/--accent\s*:\s*(#[0-9a-f]{3,8})\s*;/i)?.[1]
  return { title, themeColor: meta ?? accent ?? '#4f7cff' }
}

export function pwaFiles(o: PwaOptions): Record<string, string> {
  const dir = o.vite ? 'public/' : ''
  const href = (name: string): string => (o.vite ? `/${name}` : name)
  const manifest = {
    name: o.title, short_name: o.title.slice(0, 12), start_url: o.vite ? '/' : './index.html', scope: o.vite ? '/' : './',
    display: 'standalone', background_color: '#ffffff', theme_color: o.themeColor,
    icons: [{ src: href('icon.svg'), sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
  }
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${esc(o.themeColor)}"/><text x="256" y="330" font-family="system-ui, sans-serif" font-size="240" font-weight="700" fill="#fff" text-anchor="middle">${esc(o.title.trim().charAt(0).toUpperCase() || 'M')}</text></svg>\n`
  const sw = `// Service worker из экспорта Make: index.html — network-first (свежая версия при сети),
// остальные свои файлы — cache-first. Версию кэша меняйте при крупном обновлении.
const CACHE = 'make-pwa-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['${o.vite ? '/' : './index.html'}']))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isPage = req.mode === 'navigate' || req.destination === 'document';
  e.respondWith(isPage
    ? fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req).then((hit) => hit || caches.match('${o.vite ? '/' : './index.html'}')))
    : caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
});
`
  return { [`${dir}manifest.webmanifest`]: JSON.stringify(manifest, null, 2) + '\n', [`${dir}sw.js`]: sw, [`${dir}icon.svg`]: icon }
}

/** Добавляет в index.html ссылку на манифест, theme-color и регистрацию SW (если их ещё нет). */
export function injectPwaIntoHtml(html: string, o: PwaOptions): string {
  const href = (name: string): string => (o.vite ? `/${name}` : name)
  const head: string[] = []
  if (!/rel=["']manifest["']/i.test(html)) head.push(`<link rel="manifest" href="${href('manifest.webmanifest')}">`)
  if (!/name=["']theme-color["']/i.test(html)) head.push(`<meta name="theme-color" content="${esc(o.themeColor)}">`)
  if (!/apple-mobile-web-app-capable/i.test(html)) head.push('<meta name="apple-mobile-web-app-capable" content="yes">')
  const reg = /serviceWorker\.register/i.test(html) ? '' : `<script>if ('serviceWorker' in navigator && location.protocol !== 'file:') addEventListener('load', () => navigator.serviceWorker.register('${href('sw.js')}').catch(() => {}))</script>`
  let out = html
  if (head.length) out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `  ${head.join('\n  ')}\n</head>`) : `${head.join('\n')}\n${out}`
  if (reg) out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `  ${reg}\n</body>`) : `${out}\n${reg}`
  return out
}
