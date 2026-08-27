// REST инструмента Make: состояние проекта разговора, чтение/запись/удаление/
// переименование файлов, снимки и откат, сброс к заготовке — для редактора кода в
// панели. Плюс отдача файлов проекта для iframe-превью и ZIP-экспорт под
// `/api/preview/make/…`: там же, где прокси Web Reader, действует preview-cookie
// (iframe и ссылка «Скачать» не умеют слать Bearer). Все маршруты проверяют, что
// разговор принадлежит пользователю; изменения рассылаются владельцу `make.changed`.

import type { FastifyInstance, FastifyReply } from 'fastify'
import { MAKE_GALLERY_PAGE, MAKE_PUBLIC_PREFIX, MAKE_STORIES_PAGE, isMakeTranspiledPath, makeMimeType, normalizeMakePath } from '@voicechat/shared'
import { transpileForPreview } from '../make/transpile.js'
import { renderGalleryPage, renderStoriesPage } from '../make/stories.js'
import { readZip, ZipReadError } from '../make/zipRead.js'
import { importFromUrl, ImportUrlError } from '../make/importUrl.js'
import type { VoiceChatDb } from '../db/database.js'
import { MakeError, MakeWorkspaces } from '../make/workspace.js'
import type { MakeHub } from '../make/hub.js'

export interface MakeRoutesDeps {
  db: VoiceChatDb
  workspaces: MakeWorkspaces
  hub: MakeHub
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
  window.parent.postMessage({ type: 'vc-make.ready' }, '*');
})();
</script>`

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof MakeError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'too_large' || error.code === 'too_many_files' ? 413 : error.code === 'exists' ? 409 : 400
    return reply.code(status).send({ error: error.message, code: error.code })
  }
  throw error
}

export function registerMakeRoutes(app: FastifyInstance, deps: MakeRoutesDeps): void {
  const { db, workspaces, hub } = deps
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
  app.post<{ Params: { id: string }; Body: { dataBase64?: string; mode?: string } }>('/api/make/:id/import', { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
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

  app.post<{ Params: { id: string }; Body: { snapshotId?: string | null } | undefined }>('/api/make/:id/publish', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return await workspaces.publish(req.params.id, { snapshotId: req.body?.snapshotId ?? null }) } catch (error) { return sendError(reply, error) }
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

  app.get<{ Params: { token: string; '*': string } }>(`${MAKE_PUBLIC_PREFIX}:token/*`, async (req, reply) => {
    const conversationId = await workspaces.publishedTarget(req.params.token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Публикация не найдена или снята')
    const raw = req.params['*'] || 'index.html'
    // Публичные сториз и галерея (п.15): те же страницы, что в превью, но без входа; файлы — с публикации.
    if (raw === MAKE_STORIES_PAGE || raw === MAKE_GALLERY_PAGE) {
      const publicBase = `${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/`
      const headers = (r: FastifyReply): FastifyReply => r.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex')
        .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:")
      if (raw === MAKE_GALLERY_PAGE) return headers(reply).send(renderGalleryPage(await workspaces.stories(conversationId), publicBase))
      const q = req.query as { file?: string; story?: string }
      const index = await workspaces.publicFile(conversationId, 'index.html').catch(() => null)
      return headers(reply).send(renderStoriesPage(q.file ?? '', q.story ?? '', index ? index.data.toString('utf8') : null))
    }
    const path = raw.endsWith('/') ? `${raw}index.html` : raw
    let file
    try { file = await workspaces.publicFile(conversationId, path) } catch { file = null }
    if (!file) return reply.code(404).type('text/plain; charset=utf-8').send(`Файл не найден: ${path}`)
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
  })
  app.get<{ Params: { token: string } }>(`${MAKE_PUBLIC_PREFIX}:token`, async (req, reply) => reply.redirect(`${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/index.html`))
  app.get<{ Params: { token: string } }>(`${MAKE_PUBLIC_PREFIX}:token/`, async (req, reply) => reply.redirect(`${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/index.html`))

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
    if (!file) return reply.code(404).type('text/plain; charset=utf-8').send(`Файл не найден: ${path}`)
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
