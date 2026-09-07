// Приглашения в проект: владелец зовёт по логину или адресу, уходит письмо со
// ссылкой, приглашённый подтверждает вступление сам.
//
// Роуты намеренно разделены на два семейства. Всё, что под `/api/projects/:id/`,
// глобальный auth-hook гейтит проектным владельцем — это управление со стороны
// приглашающего. А приём и отклонение обязаны жить ВНЕ этого префикса: адресат
// ещё не участник проекта, и owner-гейт срезал бы его на входе.
//
// Публичный превью лежит под `/api/session/`, потому что isPublic пускает весь
// этот префикс целиком — расширять список публичных URL не потребовалось.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { VoiceChatDb } from '../db/database.js'
import type { Mailer } from '../users/mailer.js'
import { uid } from '../users/auth.js'
import { SlidingWindowLimiter } from '../make/rateLimit.js'
import type { ProjectRole } from '@voicechat/shared'

const errMessage = (error: unknown): string => (error instanceof Error ? error.message : 'Ошибка')
const badReq = (reply: FastifyReply, error: string): FastifyReply => reply.code(400).send({ error })
const notFound = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'not found' })

export interface InvitationRoutesOptions {
  mailer: Mailer
  publicUrl?: string | null
  /** Инвалидация уведомлений: у адресата меняется состав его проектов. */
  membershipChanged?: (projectId: string, userId?: string) => void
}

export function registerInvitationRoutes(app: FastifyInstance, db: VoiceChatDb, options: InvitationRoutesOptions): void {
  // Приглашения на произвольные адреса — потенциальный спам-релей, тем более что
  // проект теперь может завести любой пользователь. Лимит и по автору, и по IP.
  const byUser = new SlidingWindowLimiter(20, 60 * 60_000)
  const byIp = new SlidingWindowLimiter(40, 60 * 60_000)
  const previewByIp = new SlidingWindowLimiter(60, 10 * 60_000)

  const baseUrl = (req: FastifyRequest): string =>
    (options.publicUrl ?? `${String(req.headers['x-forwarded-proto'] ?? req.protocol)}://${String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost')}`).replace(/\/$/, '')

  /** Ссылка приглашения — тот же адрес, что уходит в письме. */
  const inviteLink = (req: FastifyRequest, token: string): string =>
    `${baseUrl(req)}/#/project-invite/${encodeURIComponent(token)}`

  /** Письмо приглашения. Без SMTP уходит в лог — так поток проверяется на стенде. */
  const sendInvitation = async (req: FastifyRequest, to: string, projectName: string, invitedBy: string, token: string): Promise<void> => {
    // Маршрут отдельный: `#/invite/<token>` уже занят регистрацией по админскому
    // инвайту (InviteRegister), и два разных смысла на одном адресе не развести.
    const link = inviteLink(req, token)
    await options.mailer.send({
      to,
      subject: `Приглашение в проект «${projectName}»`,
      text: `${invitedBy} приглашает вас в проект «${projectName}».\n\nОткройте ссылку, чтобы принять приглашение (действует 7 дней):\n${link}\n\nЕсли вы не ждали приглашения — просто проигнорируйте письмо.`,
      html: `<p><b>${invitedBy}</b> приглашает вас в проект «<b>${projectName}</b>».</p><p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#4f7cff;color:#fff;border-radius:8px;text-decoration:none">Принять приглашение</a></p><p style="color:#666;font-size:12px">Ссылка действует 7 дней. Или скопируйте адрес: ${link}<br>Если вы не ждали приглашения — просто проигнорируйте письмо.</p>`
    })
  }

  // --- Управление со стороны проекта (владелец; гейтит общий hook) ---

  app.get<{ Params: { id: string } }>('/api/projects/:id/invitations', async (req, reply) => {
    const list = db.projects.listProjectInvitations(uid(req), req.params.id)
    if (list) return list
    // Чтение не попадает под owner-гейт глобального hook (тот пропускает GET),
    // поэтому различаем сами: участник видит понятный отказ, посторонний — 404,
    // чтобы существование чужого проекта не подтверждалось.
    return db.projects.getProject(uid(req), req.params.id)
      ? reply.code(403).send({ error: 'forbidden', permission: 'project:settings' })
      : notFound(reply)
  })

  app.post<{ Params: { id: string }; Body: { invitee?: string; role?: ProjectRole } }>(
    '/api/projects/:id/invitations',
    async (req, reply) => {
      const invitee = (req.body?.invitee ?? '').trim()
      if (!invitee) return badReq(reply, 'Укажите логин или email')
      if (!byUser.hit(uid(req)).ok || !byIp.hit(req.ip).ok) {
        return reply.code(429).send({ error: 'Слишком много приглашений — попробуйте позже' })
      }
      const project = db.projects.getProject(uid(req), req.params.id)
      if (!project) return notFound(reply)
      try {
        const created = db.projects.createProjectInvitation(uid(req), req.params.id, invitee, { role: req.body?.role === 'owner' ? 'owner' : 'member' })
        if (!created) return notFound(reply)
        // Письмо не должно ронять создание: приглашение уже существует, а
        // владелец увидит его в списке и сможет отправить повторно.
        let mailed = false
        if (created.email) {
          try {
            await sendInvitation(req, created.email, project.name, uid(req), created.token)
            mailed = true
          } catch (error) {
            app.log.warn({ err: error }, 'не удалось отправить приглашение')
          }
        }
        db.identity.logSecurityEvent({ user: uid(req), type: 'project_invited', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), details: `${req.params.id} → ${invitee}` })
        if (created.invitation.invitedUsername) options.membershipChanged?.(req.params.id, created.invitation.invitedUsername)
        // Ссылку отдаём владельцу ровно в ответ на создание: когда письма нет
        // (приглашение по логину), передать её иначе нечем. В списке ожидающих
        // ссылки по-прежнему нет — она не должна лежать в общих выдачах.
        return { invitation: created.invitation, mailed, link: inviteLink(req, created.token) }
      } catch (error) {
        return badReq(reply, errMessage(error))
      }
    }
  )

  app.post<{ Params: { id: string; invitationId: string } }>(
    '/api/projects/:id/invitations/:invitationId/resend',
    async (req, reply) => {
      const project = db.projects.getProject(uid(req), req.params.id)
      if (!project) return notFound(reply)
      const refreshed = db.projects.refreshProjectInvitationToken(uid(req), req.params.id, req.params.invitationId)
      if (!refreshed) return notFound(reply)
      let mailed = false
      if (refreshed.email) {
        try {
          await sendInvitation(req, refreshed.email, project.name, uid(req), refreshed.token)
          mailed = true
        } catch (error) {
          app.log.warn({ err: error }, 'не удалось повторно отправить приглашение')
        }
      }
      return { invitation: refreshed.invitation, mailed, link: inviteLink(req, refreshed.token) }
    }
  )

  app.delete<{ Params: { id: string; invitationId: string } }>(
    '/api/projects/:id/invitations/:invitationId',
    async (req, reply) => {
      const ok = db.projects.revokeProjectInvitation(uid(req), req.params.id, req.params.invitationId)
      return ok ? { ok: true } : notFound(reply)
    }
  )

  // --- Сторона приглашённого (вне /api/projects/: он ещё не участник) ---

  app.get('/api/invitations', async (req) => db.projects.listInvitationsForUser(uid(req)))

  // Параметр — токен из письма ЛИБО id приглашения из списка в интерфейсе:
  // приглашённому по логину письма нет, и id — его единственный способ ответить.
  app.post<{ Params: { token: string } }>('/api/invitations/:token/accept', async (req, reply) => {
    try {
      const { projectId } = db.projects.acceptProjectInvitation(uid(req), decodeURIComponent(req.params.token))
      options.membershipChanged?.(projectId, uid(req))
      db.identity.logSecurityEvent({ user: uid(req), type: 'project_invite_accepted', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), details: projectId })
      return { projectId }
    } catch (error) {
      return badReq(reply, errMessage(error))
    }
  })

  app.post<{ Params: { token: string } }>('/api/invitations/:token/decline', async (req, reply) => {
    try {
      return { ok: db.projects.declineProjectInvitation(uid(req), decodeURIComponent(req.params.token)) }
    } catch (error) {
      return badReq(reply, errMessage(error))
    }
  })

  // --- Публичный превью по ссылке из письма ---
  //
  // Отдаёт только имя проекта, логин пригласившего и срок: этого хватает, чтобы
  // понять, куда идёшь, и мало для разведки. Перебор токенов гасит лимит по IP.
  app.get<{ Params: { token: string } }>('/api/session/invitation/:token', async (req, reply) => {
    if (!previewByIp.hit(req.ip).ok) return reply.code(429).send({ error: 'Слишком много запросов' })
    const preview = db.projects.projectInvitationPreview(decodeURIComponent(req.params.token))
    return preview ?? reply.code(404).send({ error: 'Приглашение недействительно или истекло' })
  })
}
