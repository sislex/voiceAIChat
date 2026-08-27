// Сториз проекта Make: файлы `*.stories.(jsx|tsx)` в формате CSF. Имена стори берём
// регуляркой по исходнику (именованные экспорты), а не исполнением — исполняется код
// только в браузере пользователя. Страница-раннер собирается сервером: import map и
// стили берём из index.html проекта, чтобы компонент выглядел как в приложении.

import { MAKE_REACT_IMPORT_MAP, MAKE_STORIES_PAGE, type MakeStoryFile, type MakeTestFile } from '@voicechat/shared'

export function parseStoryFile(path: string, source: string): MakeStoryFile {
  const names: string[] = []
  for (const m of source.matchAll(/^export\s+(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (m[1] && !names.includes(m[1])) names.push(m[1])
  }
  const titleMatch = source.match(/title\s*:\s*(['"`])([^'"`]+)\1/)
  const fallback = path.slice(path.lastIndexOf('/') + 1).replace(/\.stories\.(jsx|tsx)$/i, '')
  // `export const X = { ..., play: ... }` — грубо: у экспорта между его началом и следующим `export` есть `play`.
  const withPlay: string[] = []
  for (let i = 0; i < names.length; i++) {
    const start = source.indexOf(`export`, source.search(new RegExp(`export\\s+(?:const|let|var|function)\\s+${names[i]}\\b`)))
    const nextExport = source.indexOf('\nexport', start + 6)
    const body = source.slice(start, nextExport < 0 ? undefined : nextExport)
    if (/\bplay\s*[:(]/.test(body)) withPlay.push(names[i]!)
  }
  return { path, title: titleMatch?.[2] ?? fallback, stories: names, withPlay }
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
      // argTypes из CSF (control/min/max/step/options) — панель controls рисует по ним поля.
      let argTypes = {};
      try { argTypes = JSON.parse(JSON.stringify(meta.argTypes ?? {})); } catch (e) { argTypes = {}; }
      const serializable = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'function' ? '[function]' : (v !== null && typeof v === 'object' && !Array.isArray(v) && v.$$typeof) ? '[element]' : v]));
      // Enum-подобные args: строковые значения одного ключа во всех стори файла (variant: primary|secondary…).
      const options = {};
      for (const n of names) { const a = (mod[n] && mod[n].args) || {}; for (const [k, v] of Object.entries({ ...(meta.args ?? {}), ...a })) { if (typeof v === 'string' && k !== 'children' && v.length <= 32) { (options[k] = options[k] || new Set()).add(v); } } }
      const enumOptions = Object.fromEntries(Object.entries(options).filter(([, set]) => set.size >= 2).map(([k, set]) => [k, [...set]]));
      window.addEventListener('message', (e) => { const d = e.data; if (d && d.type === 'vc-make.args') { try { draw(d.args || {}); } catch (error) { fail(String(error && error.message || error)); } } });
      window.parent.postMessage({ type: 'vc-make.story', file: ${JSON.stringify(file)}, story: name, stories: names, args: serializable, options: enumOptions, argTypes: argTypes }, '*');
      // play-функция (CSF): интерактивный тест стори — клики/ввод/проверки внутри раннера; статус уходит родителю.
      const play = story.play ?? meta.play;
      if (typeof play === 'function') {
        await new Promise((r) => setTimeout(r, 50));
        const started = performance.now();
        try {
          await play({ canvasElement: document.getElementById('root'), args, step: async (label, fn) => fn() });
          window.parent.postMessage({ type: 'vc-make.play', file: ${JSON.stringify(file)}, story: name, status: 'passed', ms: Math.round(performance.now() - started) }, '*');
        } catch (error) {
          window.parent.postMessage({ type: 'vc-make.play', file: ${JSON.stringify(file)}, story: name, status: 'failed', ms: Math.round(performance.now() - started), error: String(error && error.message || error).slice(0, 500) }, '*');
        }
      }
    } catch (error) { fail(String(error && error.message || error)); }
  </script>
</body>
</html>`
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/**
 * Код использования для витрины (roadmap-4 п.28): из `export const Name = () => <X … />` берём JSX после стрелки
 * и добавляем import компонента относительно корня проекта. Объектные стори (CSF `{ args }`) — только import.
 */
export function storyUsageSnippets(path: string, source: string): Record<string, string> {
  const out: Record<string, string> = {}
  const importPath = './' + path.replace(/\.stories\.(jsx|tsx)$/i, '')
  const component = /component\s*:\s*([A-Z][A-Za-z0-9_]*)/.exec(source)?.[1] ?? /import\s*\{\s*([A-Z][A-Za-z0-9_]*)/.exec(source)?.[1] ?? null
  const importLine = component ? `import { ${component} } from '${importPath}'` : null
  for (const m of source.matchAll(/export\s+const\s+([A-Z]\w*)\s*=\s*(?:\([^)]*\)|\w+)?\s*=>\s*\(?\s*(<[\s\S]*?>)\s*\)?\s*(?=\n|$)/g)) {
    const jsx = m[2]!.trim().replace(/\)\s*$/, '')
    out[m[1]!] = [importLine, jsx].filter(Boolean).join('\n\n')
  }
  for (const m of source.matchAll(/export\s+const\s+([A-Z]\w*)\s*=\s*\{/g)) if (!out[m[1]!] && importLine) out[m[1]!] = importLine
  return out
}

/** Галерея всех стори проекта: сетка iframe-ов на раннер, поиск по названиям и код использования (п.28). */
export function renderGalleryPage(files: MakeStoryFile[], base: string, title = 'Компоненты', usage: Record<string, Record<string, string>> = {}): string {
  const cards = files.flatMap((f) => f.stories.map((name) => {
    const href = `${base}${MAKE_STORIES_PAGE}?file=${encodeURIComponent(f.path)}&story=${encodeURIComponent(name)}`
    const code = usage[f.path]?.[name]
    const codeBlock = code ? `<details class="code"><summary>Код</summary><pre>${escapeHtml(code)}</pre><button type="button" class="copy" data-code="${escapeHtml(code)}">Скопировать</button></details>` : ''
    return `<figure class="card" data-search="${escapeHtml(`${f.title} ${name} ${f.path}`.toLowerCase())}"><iframe loading="lazy" title="${escapeHtml(f.title)} / ${escapeHtml(name)}" src="${href}"></iframe><figcaption><b>${escapeHtml(f.title)}</b> · ${escapeHtml(name)} <a href="${href}" target="_blank" rel="noreferrer">открыть</a></figcaption>${codeBlock}</figure>`
  }))
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 24px; font: 14px/1.5 system-ui, sans-serif; background: #f6f7fb; color: #1a1d23; }
    h1 { margin: 0 0 16px; font-size: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .card { margin: 0; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgb(0 0 0 / .08); display: grid; }
    .card iframe { width: 100%; height: 220px; border: 0; background: repeating-conic-gradient(#eee 0 25%, transparent 0 50%) 0 0 / 16px 16px; }
    figcaption { padding: 8px 12px; font-size: 13px; display: flex; gap: 6px; align-items: baseline; }
    figcaption a { margin-left: auto; color: #4f7cff; }
    .empty { color: #666; }
    .head { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
    .search { flex: 1 1 320px; max-width: 420px; padding: 8px 12px; border: 1px solid #d5d8e0; border-radius: 8px; font: inherit; }
    .code { border-top: 1px solid #eef0f4; padding: 6px 12px 10px; font-size: 12px; }
    .code summary { cursor: pointer; color: #4f7cff; }
    .code pre { margin: 8px 0; padding: 8px; background: #f6f7fb; border-radius: 6px; overflow: auto; font: 12px/1.45 ui-monospace, Menlo, monospace; }
    .copy { font: inherit; padding: 4px 10px; border: 1px solid #d5d8e0; border-radius: 6px; background: #fff; cursor: pointer; }
    .card[hidden] { display: none; }
  </style>
</head>
<body>
  <div class="head"><h1 style="margin:0">${escapeHtml(title)}</h1>${cards.length ? '<input class="search" type="search" placeholder="Поиск компонента или стори…" aria-label="Поиск по витрине">' : ''}<span class="count"></span></div>
  ${cards.length ? `<div class="grid">${cards.join('')}</div>` : '<p class="empty">В проекте пока нет сториз (*.stories.jsx/tsx).</p>'}
  <script>
    (function(){
      var q = document.querySelector('.search'), cards = Array.prototype.slice.call(document.querySelectorAll('.card')), count = document.querySelector('.count');
      function apply(){ var v = (q && q.value || '').trim().toLowerCase(); var shown = 0; cards.forEach(function(c){ var hit = !v || (c.getAttribute('data-search') || '').indexOf(v) >= 0; c.hidden = !hit; if (hit) shown++; }); if (count) count.textContent = v ? shown + ' из ' + cards.length : ''; }
      if (q) { q.addEventListener('input', apply); var initial = new URLSearchParams(location.search).get('q'); if (initial) { q.value = initial; apply(); } }
      document.addEventListener('click', function(e){ var b = e.target && e.target.closest && e.target.closest('.copy'); if (!b) return; var code = b.getAttribute('data-code') || ''; (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(function(){ b.textContent = 'Скопировано'; setTimeout(function(){ b.textContent = 'Скопировать'; }, 1500); }, function(){ b.textContent = 'Выделите и скопируйте'; }); });
    })();
  </script>
</body>
</html>`
}

/** Имена тестов из `test('имя', …)` и компонент рядом (`Button.test.tsx` → `Button.tsx`, если есть). */
export function parseTestFile(path: string, source: string, projectPaths: ReadonlySet<string>): MakeTestFile {
  const names: string[] = []
  for (const m of source.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1).)+)\1/g)) names.push(m[2]!)
  const base = path.replace(/\.test\.(jsx|tsx|js|ts)$/i, '')
  const component = ['tsx', 'jsx', 'ts', 'js'].map((e) => `${base}.${e}`).find((p) => projectPaths.has(p)) ?? null
  return { path, names, component }
}

/**
 * Раннер тестов компонента (roadmap-4 п.3): даёт глобальные `test(name, fn)` и `expect`, хелперы
 * `render/click/type/find`; каждый результат уходит родителю кадром `vc-make.test`, итог — `vc-make.tests-done`.
 */
export function renderTestsPage(file: string, indexHtml: string | null): string {
  const { importMap, links } = extractHeadAssets(indexHtml)
  const modulePath = './' + file.split('/').map(encodeURIComponent).join('/')
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Tests · ${escapeAttr(file)}</title>
  ${links}
  <style>body{margin:0;padding:16px;font:13px/1.5 ui-monospace,monospace;background:var(--bg,#fff)} #root{min-height:40px} .vc-t{padding:2px 0} .vc-t.ok{color:#067647} .vc-t.fail{color:#b42318;white-space:pre-wrap}</style>
  <script type="importmap">${importMap}</script>
</head>
<body>
  <div id="log"></div><div id="root"></div>
  <script type="module">
    const file = ${JSON.stringify(modulePath)};
    const log = (cls, text) => { const el = document.createElement('div'); el.className = 'vc-t ' + cls; el.textContent = text; document.getElementById('log').appendChild(el); };
    const post = (m) => window.parent.postMessage({ ...m, file: ${JSON.stringify(file)} }, '*');
    const tests = [];
    window.test = (name, fn) => { tests.push({ name, fn }); };
    const fmt = (v) => { try { return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v); } catch (e) { return String(v); } };
    const textOf = (el) => (el && el.textContent != null ? el.textContent : String(el));
    window.expect = (actual) => ({
      toBe: (e) => { if (actual !== e) throw new Error('expected ' + fmt(actual) + ' toBe ' + fmt(e)); },
      toEqual: (e) => { if (JSON.stringify(actual) !== JSON.stringify(e)) throw new Error('expected ' + fmt(actual) + ' toEqual ' + fmt(e)); },
      toBeTruthy: () => { if (!actual) throw new Error('expected ' + fmt(actual) + ' toBeTruthy'); },
      toBeFalsy: () => { if (actual) throw new Error('expected ' + fmt(actual) + ' toBeFalsy'); },
      toBeNull: () => { if (actual !== null) throw new Error('expected ' + fmt(actual) + ' toBeNull'); },
      toContain: (e) => { const s = typeof actual === 'string' ? actual : textOf(actual); if (!(Array.isArray(actual) ? actual.includes(e) : s.includes(e))) throw new Error('expected ' + fmt(s) + ' toContain ' + fmt(e)); },
      toHaveTextContent: (e) => { const s = textOf(actual); if (!s.includes(e)) throw new Error('expected text ' + fmt(s) + ' to contain ' + fmt(e)); },
      toHaveClass: (c) => { if (!actual || !actual.classList || !actual.classList.contains(c)) throw new Error('expected element to have class ' + c); },
      toBeGreaterThan: (e) => { if (!(actual > e)) throw new Error('expected ' + fmt(actual) + ' > ' + fmt(e)); }
    });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const [React, { createRoot }] = await Promise.all([import('react'), import('react-dom/client')]);
      let root = null;
      const t = {
        React,
        render: async (element) => { const host = document.getElementById('root'); if (root) root.unmount(); host.replaceChildren(); root = createRoot(host); root.render(element); await sleep(30); return host; },
        find: (selectorOrText) => { const host = document.getElementById('root'); return host.querySelector(selectorOrText) || [...host.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent || '').trim() === selectorOrText) || null; },
        click: async (el) => { if (!el) throw new Error('click: элемент не найден'); el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await sleep(20); },
        type: async (el, text) => { if (!el) throw new Error('type: элемент не найден'); el.focus(); const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value')?.set; if (setter) setter.call(el, text); else el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(20); },
        sleep
      };
      await import(file);
      if (tests.length === 0) throw new Error('В файле нет вызовов test(name, fn)');
      let passed = 0, failed = 0;
      for (const { name, fn } of tests) {
        const started = performance.now();
        try { await fn(t); passed++; log('ok', '✓ ' + name); post({ type: 'vc-make.test', name, status: 'passed', ms: Math.round(performance.now() - started) }); }
        catch (error) { failed++; const msg = String(error && error.message || error).slice(0, 500); log('fail', '✗ ' + name + ' — ' + msg); post({ type: 'vc-make.test', name, status: 'failed', ms: Math.round(performance.now() - started), error: msg }); }
      }
      post({ type: 'vc-make.tests-done', passed, failed });
    } catch (error) { const msg = String(error && error.message || error); log('fail', msg); post({ type: 'vc-make.tests-done', passed: 0, failed: 1, error: msg }); }
  </script>
</body>
</html>`
}
