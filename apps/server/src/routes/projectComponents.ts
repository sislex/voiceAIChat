// REST режима «Компоненты проекта» в Make: список компонентов рабочей копии,
// Storybook проекта на машине и быстрый тикет из правки.
//
// Гейты те же три слоя, что у панели кода (`projectGit.ts`): право на не-GET
// (`repository:write`), возможность типа проекта `git` и `GitWorkspaceService.resolve`
// (членство, машина, шаринг, политика, занятость каталога). Свои проверки не заводим.
//
// Файлы компонентов читаются и пишутся уже существующими маршрутами `/git/file`:
// второй редактор файла означал бы вторую проверку прав и второй набор ошибок.

import type { FastifyInstance, FastifyReply } from 'fastify'
import { createHash } from 'node:crypto'
import {
  isProjectStoryPath, machineOrigin, parseStorybookIndex, storyPathMatches, storybookStoryId, storybookStoryName,
  type ProjectComponentEntry, type ProjectComponentsListing, type ProjectStorybookAccess, type ProjectStorybookAction
} from '@voicechat/shared'
import { uid } from '../users/auth.js'
import { GitError, type GitWorkspaceService } from '../git/workspaceService.js'
import { parseStoryFile } from '../make/stories.js'
import type { StorybookSessions } from '../components/storybookSessions.js'
import type { ComponentTicketService } from '../components/componentTicket.js'

async function handle<T>(reply: FastifyReply, work: () => Promise<T> | T): Promise<T | FastifyReply> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof GitError) {
      return reply.code(error.status).send({ error: error.code, code: error.code, message: error.message })
    }
    return reply.code(409).send({ error: 'components_failed', message: error instanceof Error ? error.message : String(error) })
  }
}

const required = (reply: FastifyReply, name: string): FastifyReply =>
  reply.code(400).send({ error: 'bad_request', message: `${name} обязателен` })

/**
 * Заголовок компонента, когда живого Storybook нет. Имя файла, а не хвост пути:
 * `src/AdminApp` из `packages/admin-app/src/AdminApp.stories.tsx` не говорит ничего,
 * а путь и так показан второй строкой.
 */
function titleFromPath(path: string): string {
  return path.replace(/\.stories\.(t|j)sx?$/i, '').split('/').filter(Boolean).pop() ?? path
}

/** Детерминированный id туннеля: тот же вход даёт тот же туннель, чужой — другой. */
function tunnelIdFor(userId: string, workspace: string, agentId: string, port: number): string {
  return createHash('sha256').update(`${userId}:${workspace}:${agentId}:${port}`).digest('hex').slice(0, 32)
}

export interface ProjectComponentsDeps {
  git: GitWorkspaceService
  storybook: StorybookSessions
  tickets: ComponentTicketService
  /**
   * Туннель до машины со Storybook (тот же механизм, что у feature-preview).
   * Нужен, когда браузер и Storybook на разных машинах: каждый модуль Vite через
   * HTTP-мост агента идёт секунды, и кадр не успевает собраться.
   */
  tunnels?: {
    isOnline(agentId: string): boolean
    ownsAgent(userId: string, agentId: string): boolean
    create(id: string, sourceAgentId: string, targetAgentId: string, targetPort: number, authorize: () => boolean): Promise<number>
    close(id: string): boolean
  }
}

export function registerProjectComponentsRoutes(app: FastifyInstance, deps: ProjectComponentsDeps): void {
  const { git, storybook, tickets } = deps

  /**
   * Список компонентов. Живой Storybook — источник лучше: у него настоящие id стори,
   * они же адрес кадра. Без него отдаём файлы `git ls-files`: список компонентов виден
   * сразу, а стори подтягиваются разбором файла по клику.
   */
  app.get<{ Params: { id: string }; Querystring: { workspace?: string } }>(
    '/api/projects/:id/components',
    async (req, reply) => {
      const workspace = req.query.workspace
      if (!workspace) return required(reply, 'workspace')
      return handle(reply, async (): Promise<ProjectComponentsListing> => {
        const ref = git.resolve(uid(req), req.params.id, workspace, { write: false })
        const session = await storybook.refresh(ref.agentId, workspace, ref.path)
        const index = await storybook.index(ref.agentId, workspace, ref.path)
        const fromIndex = index ? parseStorybookIndex(index) : []
        const files = await git.storyFiles(uid(req), req.params.id, workspace)
        // Подхваченный Storybook мог быть запущен для другого каталога — тогда его
        // компоненты не имеют отношения к этой копии. Признак принадлежности —
        // пересечение путей файлов сториз; без него берём список из репозитория.
        const belongs = !session.adopted || fromIndex.some((entry) => entry.path && storyPathMatches(entry.path, files.paths))
        if (fromIndex.length && belongs) {
          return { workspaceId: workspace, source: 'storybook', components: fromIndex, truncated: false }
        }
        return {
          workspaceId: workspace,
          source: 'files',
          components: files.paths.map((path) => ({ path, title: titleFromPath(path), stories: [] })),
          truncated: files.truncated
        }
      })
    }
  )

  /** Стори одного файла: читаем CSF и вычисляем id по правилам Storybook. */
  app.get<{ Params: { id: string }; Querystring: { workspace?: string; path?: string } }>(
    '/api/projects/:id/components/stories',
    async (req, reply) => {
      const { workspace, path } = req.query
      if (!workspace) return required(reply, 'workspace')
      if (!path) return required(reply, 'path')
      if (!isProjectStoryPath(path)) return reply.code(400).send({ error: 'bad_request', message: 'Это не файл сториз' })
      return handle(reply, async (): Promise<ProjectComponentEntry> => {
        const file = await git.file(uid(req), req.params.id, workspace, path)
        const parsed = parseStoryFile(path, file.content)
        // `default`, `meta` и типовые экспорты стори не являются — CSF считает стори
        // только именованные экспорты компонента, а мета идёт дефолтным экспортом.
        const stories = parsed.stories
          .filter((name) => name !== 'meta' && name !== 'default')
          .map((name) => ({ id: storybookStoryId(parsed.title, name), name: storybookStoryName(name) }))
        return { path, title: parsed.title, stories }
      })
    }
  )

  app.get<{ Params: { id: string }; Querystring: { workspace?: string } }>(
    '/api/projects/:id/components/storybook',
    async (req, reply) => {
      const workspace = req.query.workspace
      if (!workspace) return required(reply, 'workspace')
      return handle(reply, async () => {
        const ref = git.resolve(uid(req), req.params.id, workspace, { write: false })
        return await storybook.refresh(ref.agentId, workspace, ref.path)
      })
    }
  )

  /**
   * Запуск/остановка. Требует того же права, что правка кода: это запуск процесса
   * в рабочей копии на чужой машине, а не чтение.
   */
  app.post<{ Params: { id: string }; Body: { workspace?: string; action?: ProjectStorybookAction; port?: number; command?: string } }>(
    '/api/projects/:id/components/storybook',
    async (req, reply) => {
      const workspace = req.body?.workspace
      const action = req.body?.action
      if (!workspace) return required(reply, 'workspace')
      if (action !== 'start' && action !== 'stop' && action !== 'restart') {
        return reply.code(400).send({ error: 'bad_request', message: 'Неизвестное действие' })
      }
      // Команда приходит с клиента: в монорепо `npm run storybook` живёт не в корне,
      // а в пакете витрины, и угадать её сервер не может. Перевод строки запрещён —
      // он разорвал бы строку-сентинел, по которой мы ловим падение команды.
      const command = req.body?.command?.trim()
      if (command && (command.length > 300 || /[\r\n]/.test(command))) {
        return reply.code(400).send({ error: 'bad_request', message: 'Команда запуска слишком длинная или многострочная' })
      }
      return handle(reply, async () => {
        const ref = git.resolve(uid(req), req.params.id, workspace, { write: action === 'stop' ? false : true })
        if (action === 'stop') return storybook.stop(ref.agentId, workspace, ref.path)
        const input = { agentId: ref.agentId, workspaceId: workspace, path: ref.path, port: req.body?.port, ...(command ? { command } : {}) }
        return action === 'restart' ? await storybook.restart(input) : await storybook.start(input)
      })
    }
  )

  /**
   * Как открыть кадр стори. Выбор пути делает сервер, а не панель: только он знает,
   * онлайн ли локальный агент и на какой машине живёт Storybook.
   */
  app.post<{ Params: { id: string }; Body: { workspace?: string; localAgentId?: string | null } }>(
    '/api/projects/:id/components/storybook/open',
    async (req, reply) => {
      const workspace = req.body?.workspace
      if (!workspace) return required(reply, 'workspace')
      return handle(reply, async (): Promise<ProjectStorybookAccess> => {
        const userId = uid(req)
        const ref = git.resolve(userId, req.params.id, workspace, { write: false })
        const session = await storybook.refresh(ref.agentId, workspace, ref.path)
        if (session.state !== 'running') throw new GitError(409, 'storybook_not_running', 'Storybook не запущен — сначала поднимите его на машине')
        const proxy: ProjectStorybookAccess = {
          kind: 'proxy',
          url: `/api/preview?url=${encodeURIComponent(machineOrigin(ref.agentId, session.port))}`,
          tunnelId: null,
          note: 'Кадр идёт через мост машины: на медленном канале он собирается долго.'
        }
        const localAgentId = req.body?.localAgentId?.trim() || null
        if (!localAgentId) return proxy
        // Браузер на той же машине, что и Storybook: посредник не нужен вовсе.
        if (localAgentId === ref.agentId) {
          return { kind: 'direct', url: `http://127.0.0.1:${session.port}`, tunnelId: null, note: 'Storybook на этой же машине — кадр берётся напрямую.' }
        }
        const tunnels = deps.tunnels
        if (!tunnels || !tunnels.ownsAgent(userId, localAgentId) || !tunnels.isOnline(localAgentId)) return proxy
        const tunnelId = tunnelIdFor(userId, workspace, ref.agentId, session.port)
        try {
          const port = await tunnels.create(tunnelId, localAgentId, ref.agentId, session.port, () => true)
          return { kind: 'tunnel', url: `http://127.0.0.1:${port}`, tunnelId, note: 'Кадр идёт через локальный агент — без задержек моста.' }
        } catch {
          // Туннель не поднялся (старый агент, занятый порт) — прокси всё равно работает.
          return proxy
        }
      })
    }
  )

  /**
   * Закрыть туннель кадра: панель зовёт при уходе с вкладки. Id туннеля —
   * детерминированный хеш, поэтому доступ проверяем заново: чужой туннель нельзя
   * гасить, даже зная его идентификатор.
   */
  app.delete<{ Params: { id: string; tunnelId: string }; Querystring: { workspace?: string } }>(
    '/api/projects/:id/components/storybook/tunnels/:tunnelId',
    async (req, reply) => {
      const workspace = req.query.workspace
      if (!workspace) return required(reply, 'workspace')
      return handle(reply, async () => {
        const userId = uid(req)
        const ref = git.resolve(userId, req.params.id, workspace, { write: false })
        const session = await storybook.refresh(ref.agentId, workspace, ref.path)
        const expected = tunnelIdFor(userId, workspace, ref.agentId, session.port)
        if (req.params.tunnelId !== expected) throw new GitError(404, 'tunnel_not_found', 'Туннель не найден')
        return { closed: deps.tunnels?.close(req.params.tunnelId) ?? false }
      })
    }
  )

  /** Задача из правки: ветка, коммит, push и карточка в «Ожидает слияния». */
  app.post<{
    Params: { id: string }
    Body: { workspace?: string; title?: string; description?: string; paths?: string[]; labels?: string[] }
  }>(
    '/api/projects/:id/components/ticket',
    async (req, reply) => {
      const body = req.body ?? {}
      if (!body.workspace) return required(reply, 'workspace')
      if (!body.title?.trim()) return required(reply, 'title')
      if (!Array.isArray(body.paths) || !body.paths.length) return required(reply, 'paths')
      return handle(reply, () => tickets.create(uid(req), req.params.id, {
        workspaceId: body.workspace!,
        title: body.title!,
        description: body.description,
        paths: body.paths!,
        labels: body.labels
      }))
    }
  )
}
