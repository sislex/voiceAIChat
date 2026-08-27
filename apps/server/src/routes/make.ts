// REST инструмента Make: состояние проекта разговора, чтение/запись/удаление/
// переименование файлов, снимки и откат, сброс к заготовке — для редактора кода в
// панели. Плюс отдача файлов проекта для iframe-превью и ZIP-экспорт под
// `/api/preview/make/…`: там же, где прокси Web Reader, действует preview-cookie
// (iframe и ссылка «Скачать» не умеют слать Bearer). Все маршруты проверяют, что
// разговор принадлежит пользователю; изменения рассылаются владельцу `make.changed`.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SlidingWindowLimiter } from '../make/rateLimit.js'
import { MAKE_GALLERY_PAGE, MAKE_PUBLIC_PREFIX, MAKE_SLUG_PREFIX, MAKE_STORIES_PAGE, isMakeTranspiledPath, makeMimeType, normalizeMakePath, type MockResponse } from '@voicechat/shared'
import { transpileForPreview } from '../make/transpile.js'
import { renderGalleryPage, renderStoriesPage } from '../make/stories.js'
import { readZip, ZipReadError } from '../make/zipRead.js'
import { importFromUrl, ImportUrlError } from '../make/importUrl.js'
import type { VoiceChatDb } from '../db/database.js'
import { MakeError, MakeWorkspaces } from '../make/workspace.js'
import type { MakeLibrary } from '../make/library.js'
import type { MakeHub } from '../make/hub.js'

export interface MakeRoutesDeps {
  db: VoiceChatDb
  workspaces: MakeWorkspaces
  hub: MakeHub
  library: MakeLibrary
  /** Ограничители импорта — подменяются в тестах. */
  importLimiter?: SlidingWindowLimiter
  importUrlLimiter?: SlidingWindowLimiter
}

/** Скрипт «выбрать элемент» для превью: по сообщению родителя подсвечивает элементы и отдаёт выбранный. */
export const MAKE_INSPECTOR_SCRIPT = `<script data-vc-make-inspector>
(function(){
  if (window.parent === window) return;
  // Консоль превью: console.* и ошибки страницы уходят родителю — панель показывает их под превью.
  (function(){
    var levels = ['log','info','warn','error'];
    function fmt(a){ try { return typeof a === 'string' ? a : (a instanceof Error ? (a.message + (a.stack ? ' | ' + a.stack.split(String.fromCharCode(10)).slice(1,3).join(' | ') : '')) : JSON.stringify(a)); } catch(e){ return String(a); } }
    function send(level, args){ try { window.parent.postMessage({ type: 'vc-make.console', level: level, text: Array.prototype.map.call(args, fmt).join(' ').slice(0, 2000), at: Date.now() }, '*'); } catch(e){} }
    levels.forEach(function(l){ var orig = console[l]; console[l] = function(){ send(l, arguments); if (orig) orig.apply(console, arguments); }; });
    window.addEventListener('error', function(e){ send('error', [e.message + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '')]); });
    window.addEventListener('unhandledrejection', function(e){ send('error', ['Unhandled rejection: ' + fmt(e.reason)]); });
    // Сеть превью: fetch и XHR → родителю (метод, адрес, статус, время) — панель «Сеть» под превью.
    function net(kind, method, url, status, ok, started){ try { window.parent.postMessage({ type: 'vc-make.network', kind: kind, method: String(method || 'GET').toUpperCase(), url: String(url).slice(0, 500), status: status, ok: ok, ms: Math.round(performance.now() - started), at: Date.now() }, '*'); } catch(e){} }
    var origFetch = window.fetch;
    if (origFetch) window.fetch = function(input, init){ var started = performance.now(); var url = typeof input === 'string' ? input : (input && input.url) || String(input); var method = (init && init.method) || (input && input.method) || 'GET'; return origFetch.apply(this, arguments).then(function(res){ net('fetch', method, url, res.status, res.ok, started); return res; }, function(err){ net('fetch', method, url, 0, false, started); throw err; }); };
    var XO = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open, XS = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;
    if (XO && XS) { window.XMLHttpRequest.prototype.open = function(method, url){ this.__vc = { method: method, url: url }; return XO.apply(this, arguments); }; window.XMLHttpRequest.prototype.send = function(){ var x = this, started = performance.now(); x.addEventListener('loadend', function(){ var m = x.__vc || {}; net('xhr', m.method, m.url, x.status, x.status >= 200 && x.status < 400, started); }); return XS.apply(this, arguments); }; }
  })();
  var on = false, hovered = null, box = null;
  function ensureBox(){ if (box) return box; box = document.createElement('div'); box.setAttribute('data-vc-make-box',''); box.style.cssText='position:fixed;pointer-events:none;border:2px solid #4f7cff;background:rgba(79,124,255,.12);z-index:2147483647;border-radius:3px;transition:all .05s'; document.documentElement.appendChild(box); return box }
  function place(el){ var r = el.getBoundingClientRect(), b = ensureBox(); b.style.left=r.left+'px'; b.style.top=r.top+'px'; b.style.width=r.width+'px'; b.style.height=r.height+'px'; b.style.display='block' }
  function hide(){ if (box) box.style.display='none' }
  function selectorOf(el){ var parts=[]; while (el && el.nodeType===1 && el !== document.documentElement){ var s = el.tagName.toLowerCase(); if (el.id){ parts.unshift(s+'#'+el.id); break } var cls = (el.className && typeof el.className==='string') ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0,2) : []; if (cls.length) s += '.'+cls.join('.'); var p = el.parentElement; if (p){ var same = Array.prototype.filter.call(p.children, function(c){ return c.tagName===el.tagName }); if (same.length>1) s += ':nth-of-type('+(Array.prototype.indexOf.call(same, el)+1)+')' } parts.unshift(s); el = p } return parts.join(' > ') }
  function onMove(e){ if (!on) return; var el = e.target; if (!el || el.hasAttribute && el.hasAttribute('data-vc-make-box')) return; hovered = el; place(el) }
  var STYLE_PROPS = ['color','background-color','font-size','font-weight','text-align','padding','margin','border-radius'];
  var selectedEl = null, savedInline = '';
  function computedOf(el){ var cs = getComputedStyle(el), out = {}; STYLE_PROPS.forEach(function(p){ out[p] = cs.getPropertyValue(p); }); return out; }
  function onClick(e){ if (!on) return; e.preventDefault(); e.stopPropagation(); var el = e.target; if (!el) return; if (selectedEl && selectedEl !== el) selectedEl.style.cssText = savedInline; selectedEl = el; savedInline = el.style.cssText; var html = el.outerHTML || ''; window.parent.postMessage({ type: 'vc-make.selected', selector: selectorOf(el), tag: el.tagName.toLowerCase(), text: (el.innerText||'').trim().slice(0,200), html: html.slice(0,1500), id: el.id || '', className: (typeof el.className === 'string' ? el.className : ''), styles: computedOf(el) }, '*'); }
  // Панель стилей родителя: применяем значения inline (мгновенно), сброс возвращает исходный style.
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.style' || !selectedEl) return; selectedEl.style.cssText = savedInline; var v = d.values || {}; Object.keys(v).forEach(function(k){ if (v[k]) selectedEl.style.setProperty(k, v[k]); }); });
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.inspect') return; on = !!d.enabled; document.documentElement.style.cursor = on ? 'crosshair' : ''; if (!on) hide() });
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('scroll', function(){ if (on && hovered) place(hovered) }, true);
  // Состояние страницы (скролл, hash) — родитель восстановит его после перезагрузки превью по make.changed.
  var scrollTimer = null;
  function reportState(){ try { window.parent.postMessage({ type: 'vc-make.state', x: window.scrollX, y: window.scrollY, hash: location.hash }, '*'); } catch(e){} }
  window.addEventListener('scroll', function(){ clearTimeout(scrollTimer); scrollTimer = setTimeout(reportState, 120); }, true);
  window.addEventListener('hashchange', reportState);
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.restore') return; if (d.hash && d.hash !== location.hash) { try { location.hash = d.hash; } catch(err){} } if (typeof d.y === 'number') { window.scrollTo(d.x || 0, d.y); setTimeout(function(){ window.scrollTo(d.x || 0, d.y); }, 250); } });
  // Тема и язык превью: prefers-color-scheme нельзя подменить, поэтому переписываем media-правила таблиц
  // стилей (dark → all / light → not all) и выставляем color-scheme; язык — <html lang>.
  var envScheme = 'auto';
  function applyScheme(scheme){ envScheme = scheme; document.documentElement.style.colorScheme = scheme === 'auto' ? '' : scheme; var sheets = document.styleSheets; for (var i = 0; i < sheets.length; i++) { var rules; try { rules = sheets[i].cssRules; } catch(e) { continue; } for (var j = 0; j < rules.length; j++) { var r = rules[j]; if (!r.media) continue; var orig = r.__vcMedia || (r.__vcMedia = r.media.mediaText); if (orig.indexOf('prefers-color-scheme') < 0) continue; if (scheme === 'auto') { r.media.mediaText = orig; continue; } var wantsDark = orig.indexOf('dark') >= 0; r.media.mediaText = (wantsDark === (scheme === 'dark')) ? 'all' : 'not all'; } } }
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.env') return; if (d.scheme) applyScheme(d.scheme); if (typeof d.lang === 'string') { if (d.lang) document.documentElement.setAttribute('lang', d.lang); else document.documentElement.removeAttribute('lang'); } });
  // Комментарии (п.32): подсветка элемента по селектору и нумерованные метки, которые едут за элементами.
  var pins = [], pinLayer = null;
  function ensurePinLayer(){ if (pinLayer) return pinLayer; pinLayer = document.createElement('div'); pinLayer.setAttribute('data-vc-make-pins', ''); pinLayer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;'; document.documentElement.appendChild(pinLayer); return pinLayer; }
  function placePins(){ if (!pinLayer) return; pinLayer.innerHTML = ''; pins.forEach(function(p){ var el = null; try { el = document.querySelector(p.selector); } catch(e){} if (!el) return; var r = el.getBoundingClientRect(); var b = document.createElement('div'); b.textContent = String(p.n); b.title = p.text || ''; b.style.cssText = 'position:absolute;left:' + Math.max(0, r.right - 10) + 'px;top:' + Math.max(0, r.top - 10) + 'px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:' + (p.resolved ? '#8a8f98' : '#e5484d') + ';color:#fff;font:600 12px/20px system-ui,sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none;'; pinLayer.appendChild(b); }); }
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.pins') return; pins = Array.isArray(d.items) ? d.items : []; ensurePinLayer(); placePins(); });
  window.addEventListener('scroll', function(){ if (pins.length) placePins(); }, true);
  window.addEventListener('resize', function(){ if (pins.length) placePins(); });
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.highlight' || !d.selector) return; var el = null; try { el = document.querySelector(d.selector); } catch(err){} if (!el) return; try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(err){ el.scrollIntoView(); } var prev = el.style.outline, prevOff = el.style.outlineOffset; el.style.outline = '3px solid #e5484d'; el.style.outlineOffset = '2px'; setTimeout(function(){ el.style.outline = prev; el.style.outlineOffset = prevOff; }, 1600); });
  window.parent.postMessage({ type: 'vc-make.ready' }, '*');
})();
</script>`

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof MakeError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'too_large' || error.code === 'too_many_files' ? 413 : error.code === 'exists' ? 409 : error.code === 'quota' ? 413 : 400
    return reply.code(status).send({ error: error.message, code: error.code })
  }
  throw error
}

export function registerMakeRoutes(app: FastifyInstance, deps: MakeRoutesDeps): void {
  const { db, workspaces, hub, library } = deps
  const uid = (req: { user?: { name: string } | null }): string => req.user?.name ?? ''

  /** Разговор пользователя вида Make, иначе 404 (чужой и несуществующий неотличимы). */
  const own = (userId: string, id: string, reply: FastifyReply): boolean => {
    const conversation = db.getConversation(userId, id)
    if (!conversation || conversation.assistantKind !== 'make') {
      void reply.code(404).send({ error: 'conversation not found' })
      return false
    }
    return true
  }

  app.get<{ Params: { id: string } }>('/api/make/:id', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return await workspaces.state(req.params.id) } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/make/:id/file', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { return await workspaces.read(req.params.id, req.query.path ?? '') } catch (error) { return sendError(reply, error) }
  })

  app.put<{ Params: { id: string }; Body: { path?: string; content?: string } }>('/api/make/:id/file', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const { path, content } = req.body ?? {}
    if (typeof path !== 'string' || typeof content !== 'string') return reply.code(400).send({ error: 'path и content обязательны' })
    try {
      await workspaces.ensure(req.params.id)
      const state = await workspaces.write(req.params.id, path, content)
      hub.changed(userId, req.params.id, state.rev, [normalizeMakePath(path) ?? path])
      return state
    } catch (error) { return sendError(reply, error) }
  })

  // Загрузка бинарника из панели (картинка, шрифт): base64 раздувает на треть — лимит тела с запасом.
  app.post<{ Params: { id: string }; Body: { path?: string; dataBase64?: string } }>('/api/make/:id/upload', { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const { path, dataBase64 } = req.body ?? {}
    if (typeof path !== 'string' || typeof dataBase64 !== 'string') return reply.code(400).send({ error: 'path и dataBase64 обязательны' })
    try {
      await workspaces.ensure(req.params.id)
      const state = await workspaces.writeBuffer(req.params.id, path, Buffer.from(dataBase64, 'base64'))
      hub.changed(userId, req.params.id, state.rev, [normalizeMakePath(path) ?? path])
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.delete<{ Params: { id: string }; Querystring: { path?: string } }>('/api/make/:id/file', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    try {
      const state = await workspaces.delete(req.params.id, req.query.path ?? '')
      hub.changed(userId, req.params.id, state.rev, [req.query.path ?? ''])
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { from?: string; to?: string } }>('/api/make/:id/rename', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const { from, to } = req.body ?? {}
    if (typeof from !== 'string' || typeof to !== 'string') return reply.code(400).send({ error: 'from и to обязательны' })
    try {
      const state = await workspaces.rename(req.params.id, from, to)
      hub.changed(userId, req.params.id, state.rev, [from, to])
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/snapshots', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    return workspaces.snapshots(req.params.id)
  })

  app.post<{ Params: { id: string }; Body: { label?: string } }>('/api/make/:id/snapshots', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      await workspaces.ensure(req.params.id)
      return await workspaces.snapshot(req.params.id, typeof req.body?.label === 'string' ? req.body.label : 'Снимок пользователя')
    } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string; snapshotId: string } }>('/api/make/:id/snapshots/:snapshotId/restore', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    try {
      const state = await workspaces.restore(req.params.id, req.params.snapshotId)
      hub.changed(userId, req.params.id, state.rev, state.files.map((f) => f.path))
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string; snapshotId: string } }>('/api/make/:id/snapshots/:snapshotId/diff', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { return await workspaces.snapshotDiff(req.params.id, req.params.snapshotId) } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string; snapshotId: string }; Querystring: { path?: string } }>('/api/make/:id/snapshots/:snapshotId/file', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { return await workspaces.snapshotFile(req.params.id, req.params.snapshotId, req.query.path ?? '') } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string; snapshotId: string }; Body: { path?: string } }>('/api/make/:id/snapshots/:snapshotId/restore-file', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    if (typeof req.body?.path !== 'string') return reply.code(400).send({ error: 'path обязателен' })
    try {
      const state = await workspaces.restoreFile(req.params.id, req.params.snapshotId, req.body.path)
      hub.changed(userId, req.params.id, state.rev, [normalizeMakePath(req.body.path) ?? req.body.path])
      return state
    } catch (error) { return sendError(reply, error) }
  })

  // Импорт ZIP: base64 в JSON — архив до ~8 МБ (лимит тела с запасом на base64).
  // Rate-limit импорта (п.39): 10 ZIP и 20 URL на пользователя за 10 минут; 429 + Retry-After.
  const importLimiter = deps.importLimiter ?? new SlidingWindowLimiter(10, 10 * 60_000)
  const importUrlLimiter = deps.importUrlLimiter ?? new SlidingWindowLimiter(20, 10 * 60_000)
  const limited = (limiter: SlidingWindowLimiter, userId: string, reply: FastifyReply): boolean => {
    const v = limiter.hit(userId)
    if (v.ok) return false
    void reply.code(429).header('retry-after', String(v.retryAfterSec)).send({ error: `Слишком много импортов — повторите через ${v.retryAfterSec} с` })
    return true
  }
  app.post<{ Params: { id: string }; Body: { dataBase64?: string; mode?: string } }>('/api/make/:id/import', { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    if (limited(importLimiter, userId, reply)) return reply
    if (typeof req.body?.dataBase64 !== 'string') return reply.code(400).send({ error: 'dataBase64 обязателен' })
    const mode = req.body.mode === 'merge' ? 'merge' : 'replace'
    try {
      const entries = readZip(Buffer.from(req.body.dataBase64, 'base64'))
      const state = await workspaces.importFiles(req.params.id, entries, mode)
      hub.changed(userId, req.params.id, state.rev, state.files.map((f) => f.path))
      return state
    } catch (error) {
      if (error instanceof ZipReadError) return reply.code(400).send({ error: error.message, code: 'bad_zip' })
      return sendError(reply, error)
    }
  })

  app.post<{ Params: { id: string }; Body: { url?: string; mode?: string } }>('/api/make/:id/import-url', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    if (limited(importUrlLimiter, userId, reply)) return reply
    if (typeof req.body?.url !== 'string') return reply.code(400).send({ error: 'url обязателен' })
    const mode = req.body.mode === 'merge' ? 'merge' : 'replace'
    try {
      const files = await importFromUrl(req.body.url)
      const state = await workspaces.importFiles(req.params.id, files, mode)
      hub.changed(userId, req.params.id, state.rev, state.files.map((f) => f.path))
      return state
    } catch (error) {
      if (error instanceof ImportUrlError) return reply.code(400).send({ error: error.message, code: 'bad_url' })
      if (error instanceof Error && !(error instanceof MakeError)) return reply.code(400).send({ error: `Не удалось загрузить страницу: ${error.message}`, code: 'bad_url' })
      return sendError(reply, error)
    }
  })

  app.post<{ Params: { id: string } }>('/api/make/:id/reset', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    try {
      await workspaces.ensure(req.params.id)
      const state = await workspaces.reset(req.params.id)
      hub.changed(userId, req.params.id, state.rev, state.files.map((f) => f.path))
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { snapshotId?: string | null; slug?: string | null; password?: string | null } | undefined }>('/api/make/:id/publish', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return await workspaces.publish(req.params.id, { snapshotId: req.body?.snapshotId ?? null, slug: req.body?.slug, password: req.body?.password }) } catch (error) { return sendError(reply, error) }
  })

  // Комментарии к элементам превью (п.32).
  app.get<{ Params: { id: string } }>('/api/make/:id/comments', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return { comments: await workspaces.comments(req.params.id) } } catch (error) { return sendError(reply, error) }
  })
  app.post<{ Params: { id: string }; Body: { selector?: string; elementLabel?: string; text?: string } | undefined }>('/api/make/:id/comments', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    try {
      await workspaces.ensure(req.params.id)
      return { comments: await workspaces.addComment(req.params.id, { selector: req.body?.selector ?? '', elementLabel: req.body?.elementLabel ?? '', text: req.body?.text ?? '', author: userId }) }
    } catch (error) { return sendError(reply, error) }
  })
  app.patch<{ Params: { id: string; commentId: string }; Body: { resolved?: boolean; text?: string } | undefined }>('/api/make/:id/comments/:commentId', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { return { comments: await workspaces.updateComment(req.params.id, req.params.commentId, { resolved: req.body?.resolved, text: req.body?.text }) } } catch (error) { return sendError(reply, error) }
  })
  app.delete<{ Params: { id: string; commentId: string } }>('/api/make/:id/comments/:commentId', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { return { comments: await workspaces.removeComment(req.params.id, req.params.commentId) } } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/usage', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return await workspaces.usage(req.params.id) } catch (error) { return sendError(reply, error) }
  })
  app.post<{ Params: { id: string }; Body: { keepSnapshots?: number; shots?: boolean; unusedAssets?: boolean } | undefined }>('/api/make/:id/cleanup', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    try {
      await workspaces.ensure(req.params.id)
      const result = await workspaces.cleanup(req.params.id, { keepSnapshots: req.body?.keepSnapshots, shots: req.body?.shots, unusedAssets: req.body?.unusedAssets })
      hub.changed(userId, req.params.id, result.state.rev, [])
      return result
    } catch (error) { return sendError(reply, error) }
  })
  app.delete<{ Params: { id: string } }>('/api/make/:id/publish', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { return await workspaces.unpublish(req.params.id) } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/check', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return { issues: await workspaces.check(req.params.id) } } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { templateId?: string } }>('/api/make/:id/template', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    if (typeof req.body?.templateId !== 'string') return reply.code(400).send({ error: 'templateId обязателен' })
    try {
      const state = await workspaces.applyTemplate(req.params.id, req.body.templateId)
      hub.changed(userId, req.params.id, state.rev, state.files.map((f) => f.path))
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string }; Querystring: { q?: string } }>('/api/make/:id/search', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return { matches: await workspaces.search(req.params.id, req.query.q ?? '') } } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { query?: string; replacement?: string; matchCase?: boolean } }>('/api/make/:id/replace', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const { query, replacement, matchCase } = req.body ?? {}
    if (typeof query !== 'string' || typeof replacement !== 'string') return reply.code(400).send({ error: 'query и replacement обязательны' })
    try {
      const result = await workspaces.replaceAll(req.params.id, query, replacement, { matchCase: Boolean(matchCase) })
      if (result.files > 0) hub.changed(userId, req.params.id, result.state.rev, result.state.files.map((f) => f.path))
      return result
    } catch (error) { return sendError(reply, error) }
  })

  // ---- Личная библиотека компонентов (п.17) ----
  app.get('/api/make/library', async (req) => ({ items: await library.list(uid(req)) }))

  app.delete<{ Params: { slug: string } }>('/api/make/library/:slug', async (req) => {
    await library.remove(uid(req), req.params.slug)
    return { items: await library.list(uid(req)) }
  })

  app.post<{ Params: { id: string }; Body: { name?: string; paths?: string[] } }>('/api/make/:id/library', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const { name, paths } = req.body ?? {}
    if (typeof name !== 'string' || !Array.isArray(paths) || paths.length === 0) return reply.code(400).send({ error: 'name и paths обязательны' })
    try {
      const files: Array<{ path: string; data: Buffer }> = []
      for (const raw of paths.slice(0, 30)) {
        const file = await workspaces.readBuffer(req.params.id, String(raw))
        if (file) files.push({ path: file.path, data: file.data })
      }
      return { item: await library.save(userId, name, files, req.params.id) }
    } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string; slug: string } }>('/api/make/:id/library/:slug/insert', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    try {
      const files = await library.files(userId, req.params.slug)
      const state = await workspaces.importFiles(req.params.id, files, 'merge')
      hub.changed(userId, req.params.id, state.rev, files.map((f) => f.path))
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/shots', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { return { shots: await workspaces.shots(req.params.id) } } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { file?: string; story?: string; dataBase64?: string } }>('/api/make/:id/shots', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    const { file, story, dataBase64 } = req.body ?? {}
    if (typeof file !== 'string' || typeof story !== 'string' || typeof dataBase64 !== 'string') return reply.code(400).send({ error: 'file, story и dataBase64 обязательны' })
    try { return { shots: await workspaces.addShot(req.params.id, file, story, Buffer.from(dataBase64, 'base64')) } } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/stories', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return { files: await workspaces.stories(req.params.id) } } catch (error) { return sendError(reply, error) }
  })

  /** Тело файла для отдачи: JSX/TS — через esbuild, остальное как есть. */
  const previewBody = async (conversationId: string, file: { path: string; data: Buffer }): Promise<Buffer | string> => {
    if (!isMakeTranspiledPath(file.path)) return file.data
    const paths = new Set((await workspaces.list(conversationId)).map((f) => f.path))
    return transpileForPreview(conversationId, file.path, file.data.toString('utf8'), workspaces.rev(conversationId), (p) => paths.has(p))
  }

  // ---- Публикация: /p/<token>/… — вне /api, без авторизации; знание ссылки = доступ ----

  // Форма пароля публикации: POST сюда же (`__auth__`) с urlencoded-телом; cookie на 30 дней.
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(String(body)))) } catch (e) { done(e as Error, undefined) }
    })
  }
  const gateCookieName = (token: string): string => `vc_pub_${token}`
  const cookieValue = (req: FastifyRequest, name: string): string | null => {
    const m = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${name}=`))
    return m ? decodeURIComponent(m.slice(name.length + 1)) : null
  }
  const passwordPage = (action: string, wrong: boolean): string => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Доступ по паролю</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#f6f7fb;color:#1a1d23}form{background:#fff;padding:28px 32px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.08);display:grid;gap:12px;min-width:280px}h1{margin:0;font-size:18px}input{font:inherit;padding:10px 12px;border:1px solid #d9dbe3;border-radius:8px}button{font:inherit;padding:10px 12px;border:0;border-radius:8px;background:#4f7cff;color:#fff;cursor:pointer}.err{color:#c0392b;margin:0;font-size:13px}</style></head>
<body><form method="post" action="${action}"><h1>Проект защищён паролем</h1>${wrong ? '<p class="err">Пароль не подошёл — попробуйте ещё раз.</p>' : ''}<input type="password" name="password" placeholder="Пароль" autofocus required autocomplete="current-password"><button type="submit">Открыть</button></form></body></html>`

  /** Ответ мок-API (п.29): JSON, статус и заголовки из конверта, искусственная задержка — как у настоящего бэкенда. */
  const sendMock = async (reply: FastifyReply, mock: MockResponse): Promise<unknown> => {
    if (mock.delayMs > 0) await new Promise((r) => setTimeout(r, mock.delayMs))
    reply.code(mock.status).header('content-type', 'application/json; charset=utf-8').header('cache-control', 'no-store').header('x-vc-mock', '1')
    for (const [k, v] of Object.entries(mock.headers)) reply.header(k, v)
    return reply.send(mock.body === null ? '' : JSON.stringify(mock.body))
  }
  // Не-GET запросы превью — только моки: файлов такими методами не отдаём.
  app.route<{ Params: { id: string; '*': string } }>({
    method: ['POST', 'PUT', 'PATCH', 'DELETE'], url: '/api/preview/make/:id/*',
    handler: async (req, reply) => {
      if (!own(uid(req), req.params.id, reply)) return reply
      const mock = await workspaces.resolveMock(req.params.id, req.params['*'] || '', req.method)
      if (!mock) return reply.code(404).type('text/plain; charset=utf-8').send(`Мок не найден: mock/${req.params['*']}.${req.method}.json`)
      return sendMock(reply, mock)
    }
  })

  /** Отдача файла публикации по токену: общий код для /p/<token>/ и /s/<slug>/. */
  const servePublic = async (token: string, rawPath: string, base: string, req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const conversationId = await workspaces.publishedTarget(token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Публикация не найдена или снята')
    const raw = rawPath || 'index.html'
    // Пароль (п.25): без верной cookie — форма для HTML-запросов, 401 для остального.
    const gate = await workspaces.publicGate(conversationId)
    if (gate && cookieValue(req, gateCookieName(token)) !== gate) {
      const wantsHtml = raw === 'index.html' || raw.endsWith('/') || raw.endsWith('.html') || raw === MAKE_STORIES_PAGE || raw === MAKE_GALLERY_PAGE
      if (!wantsHtml) return reply.code(401).type('text/plain; charset=utf-8').send('Публикация защищена паролем')
      const q = req.query as { wrong?: string }
      return reply.code(401).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex')
        .send(passwordPage(`${base}__auth__?next=${encodeURIComponent(raw)}`, q.wrong === '1'))
    }
    // Публичные сториз и галерея (п.15): те же страницы, что в превью, но без входа; файлы — с публикации.
    if (raw === MAKE_STORIES_PAGE || raw === MAKE_GALLERY_PAGE) {
      const headers = (r: FastifyReply): FastifyReply => r.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex')
        .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:")
      if (raw === MAKE_GALLERY_PAGE) return headers(reply).send(renderGalleryPage(await workspaces.stories(conversationId), base))
      const q = req.query as { file?: string; story?: string }
      const index = await workspaces.publicFile(conversationId, 'index.html').catch(() => null)
      return headers(reply).send(renderStoriesPage(q.file ?? '', q.story ?? '', index ? index.data.toString('utf8') : null))
    }
    const path = raw.endsWith('/') ? `${raw}index.html` : raw
    let file
    try { file = await workspaces.publicFile(conversationId, path) } catch { file = null }
    if (!file) {
      const mock = await workspaces.resolveMock(conversationId, path, req.method, true)
      if (mock) return sendMock(reply, mock)
      return reply.code(404).type('text/plain; charset=utf-8').send(`Файл не найден: ${path}`)
    }
    if (path === 'index.html') void workspaces.countView(conversationId)
    const body = isMakeTranspiledPath(file.path)
      ? await transpileForPreview(file.cacheKey, file.path, file.data.toString('utf8'), file.rev, () => true)
      : file.data
    return reply
      .header('content-type', makeMimeType(file.path))
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:")
      .header('x-robots-tag', 'noindex')
      .send(body)
  }
  const authPublic = async (token: string, base: string, req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const conversationId = await workspaces.publishedTarget(token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Публикация не найдена или снята')
    const body = (req.body ?? {}) as { password?: string }
    const q = req.query as { next?: string }
    const next = (q.next ?? 'index.html').replace(/^\/+/, '')
    if (!(await workspaces.verifyPublicPassword(conversationId, body.password ?? ''))) return reply.redirect(`${base}${next}?wrong=1`)
    const gate = await workspaces.publicGate(conversationId)
    return reply
      .header('set-cookie', `${gateCookieName(token)}=${gate ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`)
      .redirect(`${base}${next}`)
  }

  app.get<{ Params: { token: string; '*': string } }>(`${MAKE_PUBLIC_PREFIX}:token/*`, async (req, reply) =>
    servePublic(req.params.token, req.params['*'], `${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/`, req, reply))
  /** Не-GET на публикации: `__auth__` — форма пароля, остальное — моки (после проверки пропуска). */
  const publicMutation = async (token: string, rawPath: string, base: string, req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    if (rawPath === '__auth__') return authPublic(token, base, req, reply)
    const conversationId = await workspaces.publishedTarget(token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Публикация не найдена или снята')
    const gate = await workspaces.publicGate(conversationId)
    if (gate && cookieValue(req, gateCookieName(token)) !== gate) return reply.code(401).type('text/plain; charset=utf-8').send('Публикация защищена паролем')
    const mock = await workspaces.resolveMock(conversationId, rawPath, req.method, true)
    if (!mock) return reply.code(404).type('text/plain; charset=utf-8').send('Мок не найден')
    return sendMock(reply, mock)
  }
  app.route<{ Params: { token: string; '*': string } }>({
    method: ['POST', 'PUT', 'PATCH', 'DELETE'], url: `${MAKE_PUBLIC_PREFIX}:token/*`,
    handler: async (req, reply) => publicMutation(req.params.token, req.params['*'] || '', `${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/`, req, reply)
  })
  app.get<{ Params: { token: string } }>(`${MAKE_PUBLIC_PREFIX}:token`, async (req, reply) => reply.redirect(`${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/index.html`))
  app.get<{ Params: { token: string } }>(`${MAKE_PUBLIC_PREFIX}:token/`, async (req, reply) => reply.redirect(`${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/index.html`))

  // Адрес по slug (п.25): /s/<slug>/… — то же содержимое, токен наружу не уходит.
  const slugBase = (slug: string): string => `${MAKE_SLUG_PREFIX}${encodeURIComponent(slug)}/`
  app.get<{ Params: { slug: string; '*': string } }>(`${MAKE_SLUG_PREFIX}:slug/*`, async (req, reply) => {
    const token = await workspaces.slugToken(req.params.slug)
    if (!token) return reply.code(404).type('text/plain; charset=utf-8').send('Публикация не найдена или снята')
    return servePublic(token, req.params['*'], slugBase(req.params.slug), req, reply)
  })
  app.route<{ Params: { slug: string; '*': string } }>({
    method: ['POST', 'PUT', 'PATCH', 'DELETE'], url: `${MAKE_SLUG_PREFIX}:slug/*`,
    handler: async (req, reply) => {
      const token = await workspaces.slugToken(req.params.slug)
      if (!token) return reply.code(404).type('text/plain; charset=utf-8').send('Публикация не найдена или снята')
      return publicMutation(token, req.params['*'] || '', slugBase(req.params.slug), req, reply)
    }
  })
  app.get<{ Params: { slug: string } }>(`${MAKE_SLUG_PREFIX}:slug`, async (req, reply) => reply.redirect(`${slugBase(req.params.slug)}index.html`))
  app.get<{ Params: { slug: string } }>(`${MAKE_SLUG_PREFIX}:slug/`, async (req, reply) => reply.redirect(`${slugBase(req.params.slug)}index.html`))

  // ---- Превью и экспорт (cookie-аутентификация, см. users/auth.ts) ----------

  app.get<{ Params: { id: string }; Querystring: { vite?: string } }>('/api/preview/make/:id/export.zip', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      await workspaces.ensure(req.params.id)
      const zip = await workspaces.exportZip(req.params.id, { vite: req.query.vite === '1' })
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="make-${req.params.id.slice(0, 8)}.zip"`)
        .header('cache-control', 'no-store')
        .send(zip)
    } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string; '*': string } }>('/api/preview/make/:id/*', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    await workspaces.ensure(req.params.id)
    const raw = req.params['*'] || 'index.html'
    if (raw.startsWith('__shots__/') && raw.endsWith('.png')) {
      const img = await workspaces.shotImage(req.params.id, raw.slice('__shots__/'.length, -4))
      if (!img) return reply.code(404).type('text/plain; charset=utf-8').send('Снимок не найден')
      return reply.header('content-type', 'image/png').header('cache-control', 'private, max-age=3600').send(img)
    }
    if (raw === MAKE_GALLERY_PAGE) {
      const files = await workspaces.stories(req.params.id)
      return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
        .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors 'self'")
        .send(renderGalleryPage(files, `/api/preview/make/${encodeURIComponent(req.params.id)}/`))
    }
    if (raw === MAKE_STORIES_PAGE) {
      const q = req.query as { file?: string; story?: string }
      const index = await workspaces.readBuffer(req.params.id, 'index.html').catch(() => null)
      return reply
        .header('content-type', 'text/html; charset=utf-8')
        .header('cache-control', 'no-store')
        .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors 'self'")
        .send(renderStoriesPage(q.file ?? '', q.story ?? '', index ? index.data.toString('utf8') : null))
    }
    const path = raw.endsWith('/') ? `${raw}index.html` : raw
    let file
    try { file = await workspaces.readBuffer(req.params.id, path) } catch (error) { return sendError(reply, error) }
    if (!file) {
      const mock = await workspaces.resolveMock(req.params.id, path, 'GET')
      if (mock) return sendMock(reply, mock)
      return reply.code(404).type('text/plain; charset=utf-8').send(`Файл не найден: ${path}`)
    }
    const mime = makeMimeType(file.path)
    reply
      .header('content-type', mime)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      // Превью изолировано: только свои ресурсы и inline-код, без навигации родителя.
      .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors 'self'")
    if (mime.startsWith('text/html')) {
      const html = file.data.toString('utf8')
      const injected = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${MAKE_INSPECTOR_SCRIPT}</body>`) : `${html}${MAKE_INSPECTOR_SCRIPT}`
      return reply.send(injected)
    }
    return reply.send(await previewBody(req.params.id, file))
  })

  app.get<{ Params: { id: string } }>('/api/preview/make/:id/', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    return reply.redirect(`/api/preview/make/${encodeURIComponent(req.params.id)}/index.html`)
  })
}
