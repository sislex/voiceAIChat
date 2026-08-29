// Каталог типов проекта: дерево с наследованием, личные узлы и публикация через
// утверждение администратором. Права здесь двухуровневые и намеренно разные:
//   • каталог и создание — любому вошедшему (свой тип может завести кто угодно);
//   • правка/удаление — автору личного узла либо admin;
//   • утверждение — только admin (роуты под /api/admin/, их гейтит общий hook).
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import {
  isProjectTypeVisible,
  parseProjectFeatureOverride,
  type ProjectTypeDefaults,
  type ProjectTypeNode
} from '@voicechat/shared'

const errMessage = (error: unknown): string => (error instanceof Error ? error.message : 'Ошибка')
const badReq = (reply: FastifyReply, error: string): FastifyReply => reply.code(400).send({ error })
const notFound = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'not found' })

/** Заготовки приходят из формы: отбрасываем чужие ключи, не доверяя клиенту. */
function sanitizeDefaults(value: unknown): ProjectTypeDefaults {
  if (!value || typeof value !== 'object') return {}
  const src = value as Record<string, unknown>
  const out: ProjectTypeDefaults = {}
  const strings = ['ciBaseBranch', 'ciBranchTemplate', 'testCommand'] as const
  for (const key of strings) if (typeof src[key] === 'string') out[key] = src[key] as string
  const arrays = ['technologies', 'skills'] as const
  for (const key of arrays) {
    if (Array.isArray(src[key])) out[key] = (src[key] as unknown[]).filter((x): x is string => typeof x === 'string')
  }
  if (Array.isArray(src.columns)) {
    out.columns = (src.columns as unknown[])
      .filter((c): c is { name: string; semanticType: string } =>
        Boolean(c) && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string' && typeof (c as { semanticType?: unknown }).semanticType === 'string')
      .map((c) => ({ name: c.name, semanticType: c.semanticType as ProjectTypeDefaults['columns'] extends Array<infer T> ? T extends { semanticType: infer S } ? S : never : never }))
  }
  if (src.commitPolicy === 'agent_commits' || src.commitPolicy === 'final_system_commit' || src.commitPolicy === 'manual_user_confirmation') out.commitPolicy = src.commitPolicy
  if (src.mergeTransport === 'local' || src.mergeTransport === 'github_pull_request') out.mergeTransport = src.mergeTransport
  if (src.agentPlanApprovalMode === 'manual' || src.agentPlanApprovalMode === 'automatic') out.agentPlanApprovalMode = src.agentPlanApprovalMode
  if (src.ciReuseStrategy === 'reuse' || src.ciReuseStrategy === 'clean' || src.ciReuseStrategy === 'fail') out.ciReuseStrategy = src.ciReuseStrategy
  if (src.doneRetentionDays === null || Number.isInteger(src.doneRetentionDays)) out.doneRetentionDays = src.doneRetentionDays as number | null
  if (Array.isArray((src.defaultSkills as { epic?: unknown })?.epic) || typeof src.defaultSkills === 'object') {
    const ds = (src.defaultSkills ?? {}) as Record<string, unknown>
    const pick = (k: string): string[] | undefined => Array.isArray(ds[k]) ? (ds[k] as unknown[]).filter((x): x is string => typeof x === 'string') : undefined
    const epic = pick('epic'), story = pick('story'), task = pick('task')
    if (epic || story || task) out.defaultSkills = { ...(epic ? { epic } : {}), ...(story ? { story } : {}), ...(task ? { task } : {}) }
  }
  return out
}

export function registerProjectTypeRoutes(app: FastifyInstance, db: VoiceChatDb): void {
  /** Узел, которым пользователь вправе распоряжаться: свой личный либо любой для admin. */
  /**
   * Узел, который проситель вправе менять, — либо причина отказа.
   *
   * Отказы разные по смыслу, и раньше все сводились к 404: автор опубликованного
   * типа видел его в каталоге, нажимал «Удалить» и получал «Объект не найден» —
   * будто узел исчез. Теперь про свой узел ему говорят прямо, а про чужой и
   * невидимый по-прежнему отвечают 404, чтобы не подтверждать существование.
   */
  const editableOrRefusal = (
    req: Parameters<typeof uid>[0],
    id: string
  ): { node: ProjectTypeNode } | { code: 404 | 409; error: string } => {
    const node = db.getProjectType(id)
    if (!node || !isProjectTypeVisible(node, uid(req))) return { code: 404, error: 'not found' }
    if (req.user?.role === 'admin') return { node }
    if (node.ownerId !== uid(req)) return { code: 404, error: 'not found' }
    // Опубликованный узел автор больше не правит: у него уже могут быть чужие
    // проекты и подтипы. Ему остаётся создать ребёнка или отозвать публикацию.
    if (node.status === 'published') {
      return { code: 409, error: 'Опубликованный тип меняет только администратор. Отзовите публикацию или создайте под ним подтип.' }
    }
    return { node }
  }

  app.get('/api/project-types', async (req) => db.listProjectTypes(uid(req)))

  app.get<{ Params: { id: string } }>('/api/project-types/:id', async (req, reply) => {
    const node = db.getProjectType(req.params.id)
    if (!node || !isProjectTypeVisible(node, uid(req))) return notFound(reply)
    return { node, chain: db.projectTypeChain(node.id), audit: db.projectTypeReviewAudit(node.id) }
  })

  app.post<{ Body: { parentId?: string | null; name?: string; description?: string; features?: unknown; defaults?: unknown } }>(
    '/api/project-types',
    async (req, reply) => {
      const b = req.body ?? {}
      const name = (b.name ?? '').trim()
      if (!name) return badReq(reply, 'Укажите название типа')
      const parentId = b.parentId ?? null
      // Родителем может быть только видимый узел: иначе через чужой личный узел
      // можно было бы вслепую нащупать дерево другого пользователя.
      if (parentId && !db.listProjectTypes(uid(req)).some((t) => t.id === parentId)) return badReq(reply, 'Родительский тип недоступен')
      try {
        return db.createProjectType(uid(req), {
          parentId,
          name,
          description: b.description ?? '',
          features: parseProjectFeatureOverride(b.features),
          defaults: sanitizeDefaults(b.defaults)
        })
      } catch (error) {
        return badReq(reply, errMessage(error))
      }
    }
  )

  app.patch<{ Params: { id: string }; Body: { parentId?: string | null; name?: string; description?: string; features?: unknown; defaults?: unknown } }>(
    '/api/project-types/:id',
    async (req, reply) => {
      const access = editableOrRefusal(req, req.params.id)
      if ('code' in access) return reply.code(access.code).send({ error: access.error })
      const b = req.body ?? {}
      if (b.parentId !== undefined && b.parentId && !db.listProjectTypes(uid(req)).some((t) => t.id === b.parentId)) {
        return badReq(reply, 'Родительский тип недоступен')
      }
      try {
        return db.updateProjectType(req.params.id, {
          ...(b.parentId !== undefined ? { parentId: b.parentId } : {}),
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.description !== undefined ? { description: b.description } : {}),
          ...(b.features !== undefined ? { features: parseProjectFeatureOverride(b.features) } : {}),
          ...(b.defaults !== undefined ? { defaults: sanitizeDefaults(b.defaults) } : {})
        }) ?? notFound(reply)
      } catch (error) {
        return badReq(reply, errMessage(error))
      }
    }
  )

  app.delete<{ Params: { id: string } }>('/api/project-types/:id', async (req, reply) => {
    const access = editableOrRefusal(req, req.params.id)
    if ('code' in access) return reply.code(access.code).send({ error: access.error })
    try {
      return { ok: db.deleteProjectType(req.params.id) }
    } catch (error) {
      // Отказ по инварианту (есть дети или проекты) — это 409, а не «плохой запрос».
      return reply.code(409).send({ error: errMessage(error) })
    }
  })

  app.post<{ Params: { id: string } }>('/api/project-types/:id/publish', async (req, reply) => {
    const access = editableOrRefusal(req, req.params.id)
    if ('code' in access) return reply.code(access.code).send({ error: access.error })
    try {
      return db.setProjectTypeStatus(uid(req), req.params.id, 'pending') ?? notFound(reply)
    } catch (error) {
      return reply.code(409).send({ error: errMessage(error) })
    }
  })

  app.post<{ Params: { id: string } }>('/api/project-types/:id/unpublish', async (req, reply) => {
    const node = db.getProjectType(req.params.id)
    if (!node) return notFound(reply)
    if (node.builtin) return reply.code(409).send({ error: 'Встроенный тип не участвует в публикации' })
    if (req.user?.role !== 'admin' && node.ownerId !== uid(req)) return notFound(reply)
    try {
      return db.setProjectTypeStatus(uid(req), req.params.id, 'private') ?? notFound(reply)
    } catch (error) {
      return reply.code(409).send({ error: errMessage(error) })
    }
  })

  /**
   * «Сохранить проект как подтип»: узел из текущего состояния проекта. Владельца
   * проверяет сам метод БД; гейт возможностей сюда не лезет — это операция над
   * каталогом типов, а не над подсистемой проекта.
   */
  app.post<{ Params: { id: string }; Body: { name?: string } }>('/api/projects/:id/derive-type', async (req, reply) => {
    const name = (req.body?.name ?? '').trim()
    if (!name) return badReq(reply, 'Укажите название подтипа')
    try {
      return db.deriveProjectType(uid(req), req.params.id, name) ?? notFound(reply)
    } catch (error) {
      return badReq(reply, errMessage(error))
    }
  })

  // --- Очередь на утверждение (только admin: гейтит общий hook по /api/admin/) ---

  app.get('/api/admin/project-types', async () => db.listPendingProjectTypes())

  app.post<{ Params: { id: string }; Body: { decision?: 'approve' | 'reject'; note?: string } }>(
    '/api/admin/project-types/:id/review',
    async (req, reply) => {
      const decision = req.body?.decision
      if (decision !== 'approve' && decision !== 'reject') return badReq(reply, 'decision must be approve or reject')
      const node = db.getProjectType(req.params.id)
      if (!node) return notFound(reply)
      try {
        return db.setProjectTypeStatus(uid(req), req.params.id, decision === 'approve' ? 'published' : 'rejected', req.body?.note ?? '') ?? notFound(reply)
      } catch (error) {
        return reply.code(409).send({ error: errMessage(error) })
      }
    }
  )
}
