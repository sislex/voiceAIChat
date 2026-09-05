// Роуты студии картинок: галерея разговора вида images, загрузка, чтение,
// переименование, удаление и два действия модели — «нарисовать по промпту» и
// «поправить выбранную по промпту». Доступ — владелец разговора; чужой и
// несуществующий неотличимы (404), как везде в Make/чатах.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { countRu, IMAGE_STUDIO_LIMITS, imageStudioMime, isImageStudioConversation } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { SlidingWindowLimiter } from '../make/rateLimit.js'
import { ImageStudioError, type ImageStudioStore } from '../images/studio.js'
import type { ImageStudioGenerator } from '../llm/imageStudioGenerator.js'

export interface ImageStudioRoutesDeps {
  db: VoiceChatDb
  store: ImageStudioStore
  /** Генератор изображений; функцией — в тестах подменяется фейком. */
  generator?: (userId: string) => ImageStudioGenerator
  /** Счётчик попыток пароля публичной галереи; в тестах — со своими часами. */
  passwordLimiter?: SlidingWindowLimiter
}

function sendStudioError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ImageStudioError) {
    const code = error.code === 'not_found' ? 404 : error.code === 'quota' || error.code === 'too_big' ? 413 : 400
    return reply.code(code).send({ error: error.message })
  }
  return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) })
}

export function registerImageStudioRoutes(app: FastifyInstance, deps: ImageStudioRoutesDeps): void {
  const { db, store } = deps
  const uid = (req: { user?: { name: string } | null }): string => req.user?.name ?? ''
  // Один ран на разговор: параллельные генерации дерутся за имена и квоту, а
  // пользователю всё равно нужен один результат. Здесь же живёт ручка отмены.
  const activeRuns = new Map<string, { cancel: () => void; cancelled: boolean }>()

  const withRun = async (conversationId: string, reply: FastifyReply, body: (run: { cancel: () => void; cancelled: boolean; onCancel: (fn: () => void) => void }) => Promise<FastifyReply | object>): Promise<FastifyReply | object> => {
    if (activeRuns.has(conversationId)) return reply.code(409).send({ error: 'По этому чату уже идёт генерация — дождитесь её или отмените' })
    const entry = { cancel: () => { entry.cancelled = true }, cancelled: false, onCancel: (fn: () => void) => { entry.cancel = () => { entry.cancelled = true; fn() } } }
    activeRuns.set(conversationId, entry)
    try {
      return await body(entry)
    } catch (error) {
      if (entry.cancelled) return reply.code(410).send({ error: 'Генерация отменена' })
      return sendStudioError(reply, error)
    } finally {
      activeRuns.delete(conversationId)
    }
  }

  /** Разговор пользователя вида «студия картинок», иначе 404. */
  const own = (userId: string, id: string, reply: FastifyReply): boolean => {
    const conversation = db.getConversation(userId, id)
    if (!conversation || !isImageStudioConversation(conversation)) {
      void reply.code(404).send({ error: 'conversation not found' })
      return false
    }
    return true
  }

  app.get<{ Params: { id: string } }>('/api/image-studio/:id/files', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    return store.list(req.params.id)
  })

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/image-studio/:id/file', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      const data = await store.readBuffer(req.params.id, req.query.path ?? '')
      if (!data) return reply.code(404).send({ error: 'файл не найден' })
      return reply.header('content-type', imageStudioMime(req.query.path ?? '')).send(data)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { path?: string; dataBase64?: string; source?: string } }>('/api/image-studio/:id/file', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      await store.writeBuffer(req.params.id, req.body?.path ?? '', Buffer.from(req.body?.dataBase64 ?? '', 'base64'))
      // Клиентские обработки (кроп, разметка, поворот…) сообщают исходник —
      // без этого цепочка версий рвётся на первом же локальном действии.
      if (req.body?.source) await store.setMeta(req.params.id, req.body.path ?? '', { source: req.body.source })
      return store.list(req.params.id)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.delete<{ Params: { id: string }; Querystring: { path?: string } }>('/api/image-studio/:id/file', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      await store.delete(req.params.id, req.query.path ?? '')
      return store.list(req.params.id)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { from?: string; to?: string } }>('/api/image-studio/:id/rename', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      await store.rename(req.params.id, req.body?.from ?? '', req.body?.to ?? '')
      return store.list(req.params.id)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { prompt?: string; name?: string; references?: string[] } }>('/api/image-studio/:id/generate', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const prompt = (req.body?.prompt ?? '').trim()
    if (!prompt) return reply.code(400).send({ error: 'Опишите, что нарисовать' })
    if (prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars) return reply.code(400).send({ error: `Промпт длиннее ${IMAGE_STUDIO_LIMITS.maxPromptChars} символов — сократите` })
    if (!deps.generator) return reply.code(503).send({ error: 'Генерация изображений недоступна в этой конфигурации' })
    const referenceNames = (req.body?.references ?? []).slice(0, 4)
    return withRun(req.params.id, reply, async (run) => {
      const references: Array<{ name: string; data: Buffer }> = []
      for (const name of referenceNames) {
        const data = await store.readBuffer(req.params.id, name)
        if (!data) return reply.code(404).send({ error: `Референс «${name}» не найден` })
        references.push({ name, data })
      }
      const startedAt = Date.now()
      const data = await deps.generator!(userId)({ prompt, ...(references.length ? { references } : {}), onCancel: run.onCancel })
      const name = await store.freeName(req.params.id, (req.body?.name ?? '').trim() || 'изображение.png')
      const file = await store.writeBuffer(req.params.id, name, data)
      await store.setMeta(req.params.id, name, { prompt, tookMs: Date.now() - startedAt })
      // Первый успешный промпт даёт чату говорящее имя вместо «Картинки N».
      const conversation = db.getConversation(userId, req.params.id)
      if (conversation && /^Картинки \d+$/.test(conversation.title)) {
        db.renameConversation(userId, req.params.id, `Картинки: ${prompt.slice(0, 40)}${prompt.length > 40 ? '…' : ''}`)
      }
      return { file: { ...file, prompt }, files: await store.list(req.params.id) }
    })
  })

  app.post<{ Params: { id: string }; Body: { path?: string; prompt?: string } }>('/api/image-studio/:id/edit', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const prompt = (req.body?.prompt ?? '').trim()
    if (!prompt) return reply.code(400).send({ error: 'Опишите, что изменить' })
    if (prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars) return reply.code(400).send({ error: `Промпт длиннее ${IMAGE_STUDIO_LIMITS.maxPromptChars} символов — сократите` })
    if (!deps.generator) return reply.code(503).send({ error: 'Правка изображений недоступна в этой конфигурации' })
    const sourcePath = req.body?.path ?? ''
    return withRun(req.params.id, reply, async (run) => {
      const source = await store.readBuffer(req.params.id, sourcePath)
      if (!source) return reply.code(404).send({ error: 'файл не найден' })
      const startedAt = Date.now()
      const data = await deps.generator!(userId)({ prompt, source, sourceName: sourcePath || 'source.png', onCancel: run.onCancel })
      // Правка не затирает оригинал: результат — новый файл рядом. Откат — это
      // просто удаление новой версии, истории снимков студии не нужно.
      const name = await store.freeName(req.params.id, sourcePath || 'правка.png')
      const file = await store.writeBuffer(req.params.id, name, data)
      await store.setMeta(req.params.id, name, { prompt, source: sourcePath, tookMs: Date.now() - startedAt })
      return { file: { ...file, prompt, source: sourcePath }, files: await store.list(req.params.id) }
    })
  })

  app.get<{ Params: { id: string } }>('/api/image-studio/:id/trash', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    return { items: await store.listTrash(req.params.id) }
  })

  // Очистка корзины необратима, поэтому это отдельный метод, а не флаг
  // удаления: случайно нажать «удалить» и потерять файл совсем нельзя.
  app.post<{ Params: { id: string }; Body: { name?: string } | undefined }>('/api/image-studio/:id/trash/purge', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      const removed = await store.purgeTrash(req.params.id, req.body?.name)
      return { removed, items: await store.listTrash(req.params.id) }
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { name?: string } }>('/api/image-studio/:id/restore', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      const name = await store.restore(req.params.id, req.body?.name ?? '')
      return { name, files: await store.list(req.params.id) }
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { path?: string; to?: string; copy?: boolean } }>('/api/image-studio/:id/transfer', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const to = req.body?.to ?? ''
    // Целевой чат — тоже студия этого же пользователя, иначе 404 без деталей.
    if (to === req.params.id || !own(userId, to, reply)) return reply
    try {
      const name = await store.transfer(req.params.id, req.body?.path ?? '', to, req.body?.copy ? 'copy' : 'move')
      return { name, files: await store.list(req.params.id) }
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { password?: string | null } | undefined }>('/api/image-studio/:id/publish', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    try {
      const title = db.getConversation(userId, req.params.id)?.title ?? null
      const raw = await store.publish(req.params.id, { title, ...(req.body?.password !== undefined ? { password: req.body.password } : {}) })
      return { url: `/g/${raw.token}/`, publishedAt: raw.publishedAt, views: raw.views, passwordProtected: Boolean(raw.passwordHash) }
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/image-studio/:id/publication', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    const raw = await store.publication(req.params.id)
    if (!raw) return { url: null }
    // Сводка недели — по дням из sidecar; сами дни наружу не нужны.
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const views7 = Object.entries(raw.days ?? {}).filter(([day]) => day >= weekAgo).reduce((sum, [, count]) => sum + count, 0)
    return { url: `/g/${raw.token}/`, publishedAt: raw.publishedAt, views: raw.views, views7, passwordProtected: Boolean(raw.passwordHash) }
  })

  app.delete<{ Params: { id: string } }>('/api/image-studio/:id/publish', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    await store.unpublish(req.params.id)
    return { url: null }
  })

  // Публичная страница галереи: без авторизации, по непубличному токену.
  // Только чтение и только картинки; noindex, чтобы ссылку не съели роботы.
  /**
   * Пароль публичной галереи можно было подбирать без счёта: у публичного
   * превью Make лимит стоял, а здесь нет. Окно то же — десять попыток за
   * десять минут на пару «IP + токен».
   */
  const passwordLimiter = deps.passwordLimiter ?? new SlidingWindowLimiter(10, 10 * 60_000)
  const gateCookieName = (token: string): string => `vc_gal_${token}`
  const cookieValue = (req: FastifyRequest, name: string): string | null => {
    const m = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${name}=`))
    return m ? decodeURIComponent(m.slice(name.length + 1)) : null
  }
  const passwordPage = (action: string, wrong: boolean, limited = 0): string => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Доступ по паролю</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#f6f7fb;color:#1a1d23}@media (prefers-color-scheme: dark){body{background:#111;color:#eee}form{background:#1c1c1c !important;box-shadow:none !important}input{background:#111;border-color:#333;color:#eee}}form{background:#fff;padding:28px 32px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.08);display:grid;gap:12px;min-width:280px}h1{margin:0;font-size:18px}input{font:inherit;padding:10px 12px;border:1px solid #d9dbe3;border-radius:8px}button{font:inherit;padding:10px 12px;border:0;border-radius:8px;background:#4f7cff;color:#fff;cursor:pointer}.err{color:#c0392b;margin:0;font-size:13px}</style></head>
<body><form method="post" action="${action}"><h1>Галерея защищена паролем</h1>${limited ? `<p class="err">Слишком много попыток — подождите ${limited} с.</p>` : wrong ? '<p class="err">Пароль не подошёл — попробуйте ещё раз.</p>' : ''}<input type="password" name="password" aria-label="Пароль галереи" placeholder="Пароль" autofocus required autocomplete="current-password"><button type="submit">Открыть</button></form></body></html>`

  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(String(body)))) } catch (e) { done(e as Error, undefined) }
    })
  }

  app.post<{ Params: { token: string }; Body: { password?: string } }>('/g/:token/__auth__', async (req, reply) => {
    const conversationId = await store.publishedTarget(req.params.token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Галерея не найдена или снята')
    const verdict = passwordLimiter.hit(`${req.ip}:${req.params.token}`)
    if (!verdict.ok) {
      return reply.code(429).header('retry-after', String(verdict.retryAfterSec))
        .header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
        .send(passwordPage(`/g/${req.params.token}/__auth__`, false, verdict.retryAfterSec))
    }
    if (!(await store.verifyPublicPassword(conversationId, req.body?.password ?? ''))) return reply.redirect(`/g/${req.params.token}/?wrong=1`)
    // Вошли — окно попыток по этому токену начинается заново.
    passwordLimiter.forget(`${req.ip}:${req.params.token}`)
    const gate = await store.publicGate(conversationId)
    return reply
      .header('set-cookie', `${gateCookieName(req.params.token)}=${gate ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`)
      .redirect(`/g/${req.params.token}/`)
  })

  app.get<{ Params: { token: string }; Querystring: { wrong?: string } }>('/g/:token/', async (req, reply) => {
    const conversationId = await store.publishedTarget(req.params.token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Галерея не найдена или снята')
    const gate = await store.publicGate(conversationId)
    if (gate && cookieValue(req, gateCookieName(req.params.token)) !== gate) {
      return reply.code(401).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex')
        .send(passwordPage(`/g/${req.params.token}/__auth__`, req.query.wrong === '1'))
    }
    void store.countView(conversationId)
    const publication = await store.publication(conversationId)
    const files = await store.list(conversationId)
    const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const cards = files.map((file) => `<figure data-name="${esc(file.path.toLowerCase())}"><a href="file?path=${encodeURIComponent(file.path)}" target="_blank" rel="noopener"><img loading="lazy" src="file?path=${encodeURIComponent(file.path)}" alt="${esc(file.path)}"></a><figcaption>${esc(file.path)} <a class="dl" href="file?path=${encodeURIComponent(file.path)}" download="${esc(file.path)}">скачать</a>${file.prompt ? `<small>${esc(file.prompt)}</small>` : ''}</figcaption></figure>`).join('')
    const title = publication?.title?.trim() || 'Галерея'
    // Вес рядом с числом файлов: зритель решает, качать ли это на телефоне.
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    const totalLabel = totalBytes >= 1024 * 1024
      ? `${(totalBytes / 1024 / 1024).toFixed(1)} МБ`
      : totalBytes >= 1024 ? `${Math.round(totalBytes / 1024)} КБ` : ''
    // OG-мета: мессенджеры делают fetch по ссылке и показывают карточку с
    // первой картинкой — «глухая» ссылка выглядит хуже.
    const origin = `${req.protocol}://${req.headers.host ?? ''}`
    const ogImage = files[0] ? `${origin}/g/${req.params.token}/file?path=${encodeURIComponent(files[0].path)}` : null
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="Галерея из ${countRu(files.length, 'файла', 'файлов', 'файлов')}">${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}<style>
      body{margin:0;padding:24px;font:14px/1.4 system-ui,sans-serif;background:#111;color:#eee}
      @media (prefers-color-scheme: light){body{background:#f6f7fb;color:#1a1d23}figure{background:#fff !important}figcaption small{color:#666 !important}}
      h1{font-size:18px;margin:0 0 16px}
      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
      figure{margin:0;background:#1c1c1c;border-radius:10px;padding:10px}
      img{width:100%;height:200px;object-fit:contain;background:#fff;border-radius:6px}
      figcaption{margin-top:8px;word-break:break-word}
      figcaption small{display:block;color:#999;margin-top:2px}
      .dl{color:#8ab4f8;text-decoration:none;font-size:12px;margin-left:6px}
      .find{display:flex;gap:8px;align-items:center;margin:0 0 16px;flex-wrap:wrap}
      .find input{flex:0 1 320px;padding:7px 10px;border:1px solid #333;border-radius:8px;background:#191919;color:inherit;font:inherit}
      @media (prefers-color-scheme: light){.find input{background:#fff;border-color:#d5d8e0}}
      .find small{color:#999}
      figure[hidden]{display:none}
    </style></head><body><h1>${esc(title)} · ${countRu(files.length, 'файл', 'файла', 'файлов')}${totalLabel ? ` · ${totalLabel}` : ''}</h1>${files.length >= 12 ? `<form class="find" role="search" onsubmit="return false"><label for="q">Поиск по имени</label><input id="q" type="search" autocomplete="off" placeholder="часть имени файла"><small id="found"></small></form>` : ''}<main class="grid">${cards}</main>${files.length >= 12 ? `<script>
      // Фильтр по имени — на странице, без запросов: галерею на сотню кадров
      // иначе листают руками. Имена лежат в data-name уже в нижнем регистре.
      var q=document.getElementById('q'),found=document.getElementById('found'),cards=[].slice.call(document.querySelectorAll('figure'));
      q.addEventListener('input',function(){
        var needle=q.value.trim().toLowerCase(),shown=0;
        cards.forEach(function(card){var hit=!needle||card.dataset.name.indexOf(needle)>=0;card.hidden=!hit;if(hit)shown++});
        found.textContent=needle?('Найдено: '+shown):'';
      });
    </script>` : ''}</body></html>`
    return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex').send(html)
  })

  app.get<{ Params: { token: string }; Querystring: { path?: string } }>('/g/:token/file', async (req, reply) => {
    const conversationId = await store.publishedTarget(req.params.token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Галерея не найдена или снята')
    const gate = await store.publicGate(conversationId)
    if (gate && cookieValue(req, gateCookieName(req.params.token)) !== gate) return reply.code(401).type('text/plain; charset=utf-8').send('Галерея защищена паролем')
    try {
      const data = await store.readBuffer(conversationId, req.query.path ?? '')
      if (!data) return reply.code(404).send({ error: 'файл не найден' })
      return reply.header('content-type', imageStudioMime(req.query.path ?? '')).header('cache-control', 'no-store').send(data)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/image-studio/:id/run', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    return { active: activeRuns.has(req.params.id) }
  })

  app.post<{ Params: { id: string } }>('/api/image-studio/:id/cancel', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    const run = activeRuns.get(req.params.id)
    if (!run) return { cancelled: false }
    run.cancel()
    return { cancelled: true }
  })
}
