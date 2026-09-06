// Быстрый тикет из правки компонента: задача → ветка → коммит → push → карточка,
// готовая к слиянию.
//
// Почему так, а не «создать задачу и пусть её делает модель»: правка уже сделана
// руками в рабочей копии, и единственное, чего не хватает merge-рану, — записи
// `ci_workspaces` с `pushed = 1` (её сегодня создаёт только dev-ран). Поэтому мы
// повторяем ровно те шаги, что делает CI, и ничего больше: ветка по шаблону проекта,
// коммит выбранных путей, push, запись ревизии.
//
// Merge-ран остаётся обязательным: он сам проверит конфликты, тесты и базу знаний.
// Мы лишь доводим карточку до колонки «Ожидает слияния», откуда её сливают кнопкой.

import { issueKey, type Task } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { GitError, type GitWorkspaceService } from '../git/workspaceService.js'

export interface ComponentTicketDeps {
  db: VoiceChatDb
  git: GitWorkspaceService
}

export interface ComponentTicketInput {
  workspaceId: string
  title: string
  description?: string
  paths: string[]
  labels?: string[]
}

export interface ComponentTicketOutcome {
  taskId: string
  taskNumber: number
  branch: string
  commitSha: string
  columnId: string
  readyToMerge: boolean
}

/** Имя ветки по шаблону проекта — тот же расчёт, что в dev-ране. */
export function ticketBranchName(template: string | undefined, projectName: string, task: Pick<Task, 'seq' | 'title'>): string {
  const key = issueKey(projectName, task)
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return (template || '{task_number}').replace('{task_number}', key).replace('{slug}', slug)
}

export class ComponentTicketService {
  constructor(private readonly deps: ComponentTicketDeps) {}

  async create(userId: string, projectId: string, input: ComponentTicketInput): Promise<ComponentTicketOutcome> {
    const title = input.title.trim()
    if (!title) throw new GitError(400, 'bad_request', 'У задачи должно быть название')
    const paths = [...new Set(input.paths.map((path) => path.trim()).filter(Boolean))]
    if (!paths.length) throw new GitError(400, 'bad_request', 'Нечего коммитить: не выбран ни один файл')

    // Право на запись в копию проверяем до создания задачи: иначе на доске остался бы
    // мусорный тикет без ветки, и человек не понял бы, почему «Слить» недоступно.
    const ref = this.deps.git.resolve(userId, projectId, input.workspaceId, { write: true })
    const project = this.deps.db.projects.getProject(userId, projectId)
    if (!project) throw new GitError(404, 'not_found', 'Проект не найден')
    if (!project.gitUrl) throw new GitError(409, 'git_url_missing', 'У проекта не задан адрес репозитория — ветку некуда отправлять')

    const board = this.deps.db.tasks.getBoard(userId, projectId)
    const column = board?.columns.find((c) => c.semanticType === 'awaiting_merge')
    if (!column) throw new GitError(409, 'column_missing', 'На доске нет колонки «Ожидает слияния» — задачу некуда положить')

    const baseBranch = project.ciBaseBranch || 'main'
    const task = this.deps.db.tasks.createTask(userId, projectId, {
      columnId: column.id,
      title,
      description: input.description?.trim() || undefined,
      labels: input.labels?.length ? input.labels : undefined,
      source: 'make-components'
    })
    if (!task) throw new GitError(409, 'task_not_created', 'Не удалось создать задачу')

    const branch = ticketBranchName(project.ciBranchTemplate, project.name, task)
    const message = `${issueKey(project.name, task)} ${title}`
    try {
      await this.deps.git.createBranch(userId, projectId, input.workspaceId, branch, baseBranch)
      const commit = await this.deps.git.commit(userId, projectId, input.workspaceId, { message, paths })
      const push = await this.deps.git.push(userId, projectId, input.workspaceId, branch)
      // Запись ревизии делает сам сервис только для копий задач (`ws:`); для общей копии
      // проекта её нет, поэтому источник для merge-рана заводим здесь явно.
      const workspace = this.deps.db.ci.createCiWorkspace({ projectId, taskId: task.id, agentId: ref.agentId, path: ref.path })
      this.deps.db.ci.updateCiWorkspaceRevision(workspace.id, branch, push.sha || commit.sha, true)
      return {
        taskId: task.id,
        taskNumber: task.seq ?? 0,
        branch,
        commitSha: push.sha || commit.sha,
        columnId: column.id,
        readyToMerge: true
      }
    } finally {
      // Возвращаем копию на базовую ветку в любом случае: оставленная на ветке задачи
      // общая папка проекта ломает следующий системный ход проекта (он ждёт main).
      await this.deps.git.checkout(userId, projectId, input.workspaceId, baseBranch, true).catch(() => undefined)
    }
  }
}
