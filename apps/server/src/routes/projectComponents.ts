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
import {
  isProjectStoryPath, parseStorybookIndex, storybookStoryId, storybookStoryName,
  type ProjectComponentEntry, type ProjectComponentsListing, type ProjectStorybookAction
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

export interface ProjectComponentsDeps {
  git: GitWorkspaceService
  storybook: StorybookSessions
  tickets: ComponentTicketService
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
        const known = new Set(files.paths)
        const belongs = !session.adopted || fromIndex.some((entry) => entry.path && known.has(entry.path))
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
