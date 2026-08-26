// REST инструмента Make: состояние проекта разговора, чтение/запись/удаление/
// переименование файлов, снимки и откат, сброс к заготовке — для редактора кода в
// панели. Плюс отдача файлов проекта для iframe-превью и ZIP-экспорт под
// `/api/preview/make/…`: там же, где прокси Web Reader, действует preview-cookie
// (iframe и ссылка «Скачать» не умеют слать Bearer). Все маршруты проверяют, что
// разговор принадлежит пользователю; изменения рассылаются владельцу `make.changed`.

import type { FastifyInstance, FastifyReply } from 'fastify'
import { MAKE_PUBLIC_PREFIX, makeMimeType, normalizeMakePath } from '@voicechat/shared'
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
  var on = false, hovered = null, box = null;
  function ensureBox(){ if (box) return box; box = document.createElement('div'); box.setAttribute('data-vc-make-box',''); box.style.cssText='position:fixed;pointer-events:none;border:2px solid #4f7cff;background:rgba(79,124,255,.12);z-index:2147483647;border-radius:3px;transition:all .05s'; document.documentElement.appendChild(box); return box }
  function place(el){ var r = el.getBoundingClientRect(), b = ensureBox(); b.style.left=r.left+'px'; b.style.top=r.top+'px'; b.style.width=r.width+'px'; b.style.height=r.height+'px'; b.style.display='block' }
  function hide(){ if (box) box.style.display='none' }
  function selectorOf(el){ var parts=[]; while (el && el.nodeType===1 && el !== document.documentElement){ var s = el.tagName.toLowerCase(); if (el.id){ parts.unshift(s+'#'+el.id); break } var cls = (el.className && typeof el.className==='string') ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0,2) : []; if (cls.length) s += '.'+cls.join('.'); var p = el.parentElement; if (p){ var same = Array.prototype.filter.call(p.children, function(c){ return c.tagName===el.tagName }); if (same.length>1) s += ':nth-of-type('+(Array.prototype.indexOf.call(same, el)+1)+')' } parts.unshift(s); el = p } return parts.join(' > ') }
  function onMove(e){ if (!on) return; var el = e.target; if (!el || el.hasAttribute && el.hasAttribute('data-vc-make-box')) return; hovered = el; place(el) }
  function onClick(e){ if (!on) return; e.preventDefault(); e.stopPropagation(); var el = e.target; if (!el) return; var html = el.outerHTML || ''; window.parent.postMessage({ type: 'vc-make.selected', selector: selectorOf(el), tag: el.tagName.toLowerCase(), text: (el.innerText||'').trim().slice(0,200), html: html.slice(0,1500) }, '*'); }
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.inspect') return; on = !!d.enabled; document.documentElement.style.cursor = on ? 'crosshair' : ''; if (!on) hide() });
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('scroll', function(){ if (on && hovered) place(hovered) }, true);
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

  app.post<{ Params: { id: string } }>('/api/make/:id/publish', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return await workspaces.publish(req.params.id) } catch (error) { return sendError(reply, error) }
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

  // ---- Публикация: /p/<token>/… — вне /api, без авторизации; знание ссылки = доступ ----

  app.get<{ Params: { token: string; '*': string } }>(`${MAKE_PUBLIC_PREFIX}:token/*`, async (req, reply) => {
    const conversationId = await workspaces.publishedTarget(req.params.token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Публикация не найдена или снята')
    const raw = req.params['*'] || 'index.html'
    const path = raw.endsWith('/') ? `${raw}index.html` : raw
    let file
    try { file = await workspaces.readBuffer(conversationId, path) } catch { file = null }
    if (!file) return reply.code(404).type('text/plain; charset=utf-8').send(`Файл не найден: ${path}`)
    return reply
      .header('content-type', makeMimeType(file.path))
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:")
      .header('x-robots-tag', 'noindex')
      .send(file.data)
  })
  app.get<{ Params: { token: string } }>(`${MAKE_PUBLIC_PREFIX}:token`, async (req, reply) => reply.redirect(`${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/index.html`))
  app.get<{ Params: { token: string } }>(`${MAKE_PUBLIC_PREFIX}:token/`, async (req, reply) => reply.redirect(`${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/index.html`))

  // ---- Превью и экспорт (cookie-аутентификация, см. users/auth.ts) ----------

  app.get<{ Params: { id: string } }>('/api/preview/make/:id/export.zip', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      await workspaces.ensure(req.params.id)
      const zip = await workspaces.exportZip(req.params.id)
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
    return reply.send(file.data)
  })

  app.get<{ Params: { id: string } }>('/api/preview/make/:id/', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    return reply.redirect(`/api/preview/make/${encodeURIComponent(req.params.id)}/index.html`)
  })
}
