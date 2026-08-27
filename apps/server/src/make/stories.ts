// Сториз проекта Make: файлы `*.stories.(jsx|tsx)` в формате CSF. Имена стори берём
// регуляркой по исходнику (именованные экспорты), а не исполнением — исполняется код
// только в браузере пользователя. Страница-раннер собирается сервером: import map и
// стили берём из index.html проекта, чтобы компонент выглядел как в приложении.

import { MAKE_REACT_IMPORT_MAP, type MakeStoryFile } from '@voicechat/shared'

export function parseStoryFile(path: string, source: string): MakeStoryFile {
  const names: string[] = []
  for (const m of source.matchAll(/^export\s+(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (m[1] && !names.includes(m[1])) names.push(m[1])
  }
  const titleMatch = source.match(/title\s*:\s*(['"`])([^'"`]+)\1/)
  const fallback = path.slice(path.lastIndexOf('/') + 1).replace(/\.stories\.(jsx|tsx)$/i, '')
  return { path, title: titleMatch?.[2] ?? fallback, stories: names }
}

/** Import map и `<link rel="stylesheet">` из index.html проекта — либо React-дефолты. */
export function extractHeadAssets(indexHtml: string | null): { importMap: string; links: string } {
  const mapMatch = indexHtml?.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i)
  const importMap = mapMatch?.[1]?.trim() || JSON.stringify({ imports: MAKE_REACT_IMPORT_MAP })
  const links = indexHtml ? [...indexHtml.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi)].map((m) => m[0]).join('\n  ') : ''
  return { importMap, links }
}

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** HTML раннера: рендерит одну стори `story` из файла `file`, ошибки — на экран, а не только в консоль. */
export function renderStoriesPage(file: string, story: string, indexHtml: string | null): string {
  const { importMap, links } = extractHeadAssets(indexHtml)
  const modulePath = './' + file.split('/').map(encodeURIComponent).join('/')
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Storybook · ${escapeAttr(file)}</title>
  ${links}
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; background: var(--bg, #fff); }
    #root { display: contents; }
    .vc-story-error { font: 13px/1.5 ui-monospace, monospace; white-space: pre-wrap; color: #b42318; background: #fef3f2; border: 1px solid #fda29b; border-radius: 8px; padding: 12px 14px; max-width: 720px; }
  </style>
  <script type="importmap">${importMap}</script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    const file = ${JSON.stringify(modulePath)};
    const storyName = ${JSON.stringify(story)};
    (function(){ var levels=['log','info','warn','error']; function fmt(a){ try { return typeof a==='string'?a:(a instanceof Error?a.message:JSON.stringify(a)); } catch(e){ return String(a); } } function send(level,args){ try { window.parent.postMessage({ type:'vc-make.console', level:level, text:Array.prototype.map.call(args,fmt).join(' ').slice(0,2000), at:Date.now() }, '*'); } catch(e){} } levels.forEach(function(l){ var o=console[l]; console[l]=function(){ send(l,arguments); if(o) o.apply(console,arguments); }; }); window.addEventListener('error', function(e){ send('error',[e.message]); }); })();
    const fail = (message) => { const el = document.createElement('pre'); el.className = 'vc-story-error'; el.textContent = message; document.getElementById('root').replaceChildren(el); };
    window.addEventListener('error', (e) => fail(String(e.message || e.error)));
    window.addEventListener('unhandledrejection', (e) => fail(String(e.reason && e.reason.message || e.reason)));
    try {
      const [React, { createRoot }, mod] = await Promise.all([import('react'), import('react-dom/client'), import(file)]);
      const meta = mod.default ?? {};
      const names = Object.keys(mod).filter((k) => k !== 'default');
      const name = storyName && mod[storyName] ? storyName : names[0];
      if (!name) throw new Error('В файле нет именованных экспортов-стори');
      const story = mod[name];
      const args = { ...(meta.args ?? {}), ...(story.args ?? {}) };
      const render = story.render ?? meta.render;
      const component = story.component ?? meta.component;
      if (!render && !component) throw new Error('У стори «' + name + '» нет component или render');
      const root = createRoot(document.getElementById('root'));
      // Панель controls родителя присылает переопределения args; функции в args сериализовать нельзя — отдаём метку.
      const draw = (overrides) => { const merged = { ...args, ...overrides }; root.render(render ? render(merged) : React.createElement(component, merged)); };
      draw({});
      const serializable = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'function' ? '[function]' : (v !== null && typeof v === 'object' && !Array.isArray(v) && v.$$typeof) ? '[element]' : v]));
      // Enum-подобные args: строковые значения одного ключа во всех стори файла (variant: primary|secondary…).
      const options = {};
      for (const n of names) { const a = (mod[n] && mod[n].args) || {}; for (const [k, v] of Object.entries({ ...(meta.args ?? {}), ...a })) { if (typeof v === 'string' && k !== 'children' && v.length <= 32) { (options[k] = options[k] || new Set()).add(v); } } }
      const enumOptions = Object.fromEntries(Object.entries(options).filter(([, set]) => set.size >= 2).map(([k, set]) => [k, [...set]]));
      window.addEventListener('message', (e) => { const d = e.data; if (d && d.type === 'vc-make.args') { try { draw(d.args || {}); } catch (error) { fail(String(error && error.message || error)); } } });
      window.parent.postMessage({ type: 'vc-make.story', file: ${JSON.stringify(file)}, story: name, stories: names, args: serializable, options: enumOptions }, '*');
    } catch (error) { fail(String(error && error.message || error)); }
  </script>
</body>
</html>`
}
