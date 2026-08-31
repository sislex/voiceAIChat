// REST панели кода: состояние рабочей копии задачи/сессии, ветки, файлы, сравнение,
// правка, коммит и push.
//
// Гейты стоят в трёх слоях, и ни один не дублирует другой:
//   1. глобальный hook авторизации — право `repository:write` на любой POST
//      (`users/auth.ts`, карта URL→право);
//   2. возможность типа проекта `git` (та же карта) — в проекте без git этих
//      подсистем нет вовсе;
//   3. `GitWorkspaceService.resolve` — членство в проекте, доступ к машине, режим
//      шаринга, политика машины, занятость каталога раном.
// Поэтому обработчики здесь тонкие: разобрать запрос и перевести `GitError` в код.

import type { FastifyInstance, FastifyReply } from 'fastify'
import { uid } from '../users/auth.js'
import { GitError, type GitWorkspaceService } from '../git/workspaceService.js'

/** Ошибка сервиса → ответ с кодом: UI показывает по коду своё состояние. */
async function handle<T>(reply: FastifyReply, work: () => Promise<T> | T): Promise<T | FastifyReply> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof GitError) {
      return reply.code(error.status).send({ error: error.code, code: error.code, message: error.message })
    }
    return reply.code(500).send({ error: 'git_failed', message: error instanceof Error ? error.message : String(error) })
  }
}

const required = (reply: FastifyReply, name: string): FastifyReply =>
  reply.code(400).send({ error: 'bad_request', message: `${name} обязателен` })

export function registerProjectGitRoutes(app: FastifyInstance, git: GitWorkspaceService): void {
  app.get<{ Params: { id: string } }>('/api/projects/:id/git/workspaces', async (req, reply) =>
    handle(reply, () => git.listWorkspaces(uid(req), req.params.id)))

  app.get<{ Params: { id: string }; Querystring: { workspace?: string } }>(
    '/api/projects/:id/git/status',
    async (req, reply) => {
      if (!req.query.workspace) return required(reply, 'workspace')
      return handle(reply, () => git.status(uid(req), req.params.id, req.query.workspace!))
    }
  )

  app.get<{ Params: { id: string }; Querystring: { workspace?: string; refresh?: string } }>(
    '/api/projects/:id/git/branches',
    async (req, reply) => {
      if (!req.query.workspace) return required(reply, 'workspace')
      return handle(reply, () => git.branches(uid(req), req.params.id, req.query.workspace!, req.query.refresh === '1'))
    }
  )

  app.get<{ Params: { id: string }; Querystring: { workspace?: string; dir?: string; ref?: string } }>(
    '/api/projects/:id/git/tree',
    async (req, reply) => {
      if (!req.query.workspace) return required(reply, 'workspace')
      return handle(reply, () => git.tree(uid(req), req.params.id, req.query.workspace!, req.query.dir ?? '', req.query.ref))
    }
  )

  app.get<{ Params: { id: string }; Querystring: { workspace?: string; path?: string; ref?: string } }>(
    '/api/projects/:id/git/file',
    async (req, reply) => {
      if (!req.query.workspace) return required(reply, 'workspace')
      if (!req.query.path) return required(reply, 'path')
      return handle(reply, () => git.file(uid(req), req.params.id, req.query.workspace!, req.query.path!, req.query.ref))
    }
  )

  app.get<{ Params: { id: string }; Querystring: { workspace?: string; path?: string; base?: string } }>(
    '/api/projects/:id/git/diff',
    async (req, reply) => {
      if (!req.query.workspace) return required(reply, 'workspace')
      if (!req.query.path) return required(reply, 'path')
      return handle(reply, () => git.diff(uid(req), req.params.id, req.query.workspace!, req.query.path!, req.query.base))
    }
  )

  app.post<{ Params: { id: string }; Body: { workspace?: string; path?: string; content?: string } }>(
    '/api/projects/:id/git/file',
    async (req, reply) => {
      const body = req.body ?? {}
      if (!body.workspace) return required(reply, 'workspace')
      if (!body.path) return required(reply, 'path')
      if (typeof body.content !== 'string') return required(reply, 'content')
      return handle(reply, () => git.saveFile(uid(req), req.params.id, body.workspace!, body.path!, body.content!))
    }
  )

  app.post<{ Params: { id: string }; Body: { workspace?: string; branch?: string; confirmDirty?: boolean } }>(
    '/api/projects/:id/git/checkout',
    async (req, reply) => {
      const body = req.body ?? {}
      if (!body.workspace) return required(reply, 'workspace')
      if (!body.branch) return required(reply, 'branch')
      return handle(reply, () => git.checkout(uid(req), req.params.id, body.workspace!, body.branch!, body.confirmDirty === true))
    }
  )

  app.post<{ Params: { id: string }; Body: { workspace?: string; name?: string; from?: string } }>(
    '/api/projects/:id/git/branch',
    async (req, reply) => {
      const body = req.body ?? {}
      if (!body.workspace) return required(reply, 'workspace')
      if (!body.name) return required(reply, 'name')
      return handle(reply, () => git.createBranch(uid(req), req.params.id, body.workspace!, body.name!, body.from))
    }
  )

  app.post<{ Params: { id: string }; Body: { workspace?: string; message?: string; paths?: string[]; all?: boolean } }>(
    '/api/projects/:id/git/commit',
    async (req, reply) => {
      const body = req.body ?? {}
      if (!body.workspace) return required(reply, 'workspace')
      if (typeof body.message !== 'string') return required(reply, 'message')
      return handle(reply, () => git.commit(uid(req), req.params.id, body.workspace!, {
        message: body.message!,
        ...(body.paths ? { paths: body.paths } : {}),
        ...(body.all !== undefined ? { all: body.all } : {})
      }))
    }
  )

  app.post<{ Params: { id: string }; Body: { workspace?: string; branch?: string } }>(
    '/api/projects/:id/git/push',
    async (req, reply) => {
      const body = req.body ?? {}
      if (!body.workspace) return required(reply, 'workspace')
      return handle(reply, () => git.push(uid(req), req.params.id, body.workspace!, body.branch))
    }
  )
}
