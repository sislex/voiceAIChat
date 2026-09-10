import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  APPLICATION_CATALOG,
  type ApplicationReleaseInput,
  type ApplicationEnvironmentName,
  type ApplicationDeployInput
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import {
  ApplicationReleaseManager,
  applicationDeployConfigPath,
  type ApplicationDeployTarget
} from '../releases/applicationReleaseManager.js'
import type { ReleaseManager } from '../releases/releaseManager.js'
import type { ManagedEnvironmentResolver } from '../releases/managedEnvironmentResolver.js'
import {
  releaseCiTarget,
  releaseApplicationTarget
} from '../releases/targets.js'
type Params = { id: string; environment: ApplicationEnvironmentName }
function environment(value: unknown): ApplicationEnvironmentName {
  if (value !== 'staging' && value !== 'production')
    throw new Error('Неизвестное окружение')
  return value
}
export function registerApplicationReleaseRoutes(
  app: FastifyInstance,
  db: VoiceChatDb,
  manager: ApplicationReleaseManager,
  legacy: ReleaseManager,
  managed: ManagedEnvironmentResolver
): void {
  const guard = {
    preHandler: async (
      req: FastifyRequest,
      reply: import('fastify').FastifyReply
    ) => {
      if (
        !(await db.projects.isProjectOwner(uid(req), (req.params as Params).id))
      )
        return reply.code(403).send({ error: 'forbidden' })
    }
  }
  const target = async (
    userId: string,
    projectId: string,
    kind: ApplicationEnvironmentName
  ): Promise<ApplicationDeployTarget> => {
    const resolved = await releaseApplicationTarget(
      db,
      managed,
      userId,
      projectId,
      kind
    )
    if (!resolved)
      throw new Error(
        'Настройте отдельное окружение и конфигурацию приложений площадки'
      )
    if (!(await db.machines.canWriteAgent(userId, resolved.agentId, projectId)))
      throw new Error('Для deploy нужен полный доступ к машине')
    if (!legacy.isOnline(resolved.agentId))
      throw new Error('Машина deploy offline')
    return {
      ...resolved,
      configPath: applicationDeployConfigPath(resolved, kind)
    }
  }
  const failure = (reply: import('fastify').FastifyReply, error: unknown) =>
    reply
      .code(400)
      .send({ error: error instanceof Error ? error.message : String(error) })
  const base = '/api/projects/:id/application-releases'
  app.get<{ Params: { id: string } }>(base + '/catalog', async (req, reply) => {
    if (!(await db.projects.isProjectMember(uid(req), req.params.id)))
      return reply.code(404).send({ error: 'not found' })
    return APPLICATION_CATALOG
  })
  app.get<{ Params: Params }>(
    base + '/environments/:environment',
    async (req, reply) => {
      if (!(await db.projects.isProjectMember(uid(req), req.params.id)))
        return reply.code(404).send({ error: 'not found' })
      try {
        return await db.releases.applicationReleaseOverview(
          uid(req),
          req.params.id,
          environment(req.params.environment)
        )
      } catch (error) {
        return failure(reply, error)
      }
    }
  )
  app.post<{
    Params: { id: string }
    Body: { input: ApplicationReleaseInput; agentId?: string }
  }>(base, guard, async (req, reply) => {
    try {
      const ci = await releaseCiTarget(
        db,
        legacy,
        uid(req),
        req.params.id,
        req.body?.agentId
      )
      return reply
        .code(202)
        .send(await manager.prepare(uid(req), ci, req.body?.input))
    } catch (error) {
      return failure(reply, error)
    }
  })
  app.post<{ Params: Params; Body: { expectedRevision: number } }>(
    base + '/environments/:environment/observe',
    guard,
    async (req, reply) => {
      try {
        const kind = environment(req.params.environment)
        if (
          !Number.isSafeInteger(req.body?.expectedRevision) ||
          req.body.expectedRevision < 0
        )
          throw new Error('Нужна ревизия окружения')
        return await manager.observe(
          uid(req),
          await target(uid(req), req.params.id, kind),
          kind,
          req.body.expectedRevision
        )
      } catch (error) {
        return failure(reply, error)
      }
    }
  )
  app.post<{ Params: Params; Body: ApplicationDeployInput }>(
    base + '/environments/:environment/deploy',
    guard,
    async (req, reply) => {
      try {
        const kind = environment(req.params.environment)
        return reply
          .code(202)
          .send(
            await manager.deploy(
              uid(req),
              await target(uid(req), req.params.id, kind),
              kind,
              req.body
            )
          )
      } catch (error) {
        return failure(reply, error)
      }
    }
  )
  app.post<{ Params: Params }>(
    base + '/environments/:environment/reconcile',
    guard,
    async (req, reply) => {
      try {
        const kind = environment(req.params.environment)
        return await manager.reconcileOne(
          uid(req),
          await target(uid(req), req.params.id, kind),
          kind
        )
      } catch (error) {
        return failure(reply, error)
      }
    }
  )
  // Не держим запуск сервера на таймауте offline-машины. Оборванный deploy
  // остаётся заблокированным до подтверждённой сверки или следующей попытки.
  void manager
    .reconcile(async (record) => {
      if (
        !(await db.projects.isProjectOwner(
          record.triggeredBy,
          record.projectId
        ))
      )
        return null
      return target(record.triggeredBy, record.projectId, record.environment)
    })
    .catch((error) =>
      app.log.error({ err: error }, 'application release reconcile')
    )
}
