// Git в рабочей копии задачи или сессии: резолвер целей и операции над ними.
//
// Главный принцип: клиент присылает id рабочей копии, а не путь. Путь и машину сервис
// берёт из своих таблиц (`ci_workspaces`, `task_repositories`, разговор,
// `project_machines`), поэтому «прочитай что угодно на чужой машине» невозможно
// конструктивно, а не проверкой.
//
// Второй принцип: чтение не блокируется никогда, запись — пока каталог занят активным
// CI- или merge-раном. Два процесса в одной рабочей копии перемешали бы коммиты, а
// cleanup-шаг рана может снести каталог посреди нашего коммита.

import {
  GIT_MAX_CHANGES, GIT_TEXT_MAX_BYTES, buildGitWorkspaceId, isProtectedGitBranch,
  isSafeRepoRelativePath, isValidGitBranchName, isValidGitRef, normalizeCommitMessage,
  parseAheadBehind, parseGitLog, parseGitLsTree, parseGitRefs, parseGitStatusPorcelain,
  parseGitWorkspaceId, splitGitSections,
  GIT_MAX_GREP, GIT_MAX_LOG, parseGitGrep, parseGitNameStatus,
  type AgentPolicy, type FsResult, type GitBranchChanges, type GitBranchList,
  type GitCheckoutResult, type GitCommitDetail, type GitCommitResult, type GitConflictSide,
  type GitConflictStages, type GitDiscardResult, type GitFileContent, type GitFileDiff,
  type GitGrepResult, type GitPullMode, type GitPullResult, type GitPushResult,
  type GitSaveFileResult, type GitTreeListing, type GitWorkspaceProblem,
  type GitWorkspaceRef, type GitWorkspaceStatus
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { buildShellCommand } from '../ci/executor.js'
import type { CommandGate } from '../agents/commandGate.js'
import { hasProjectPermission } from '../users/auth.js'
import {
  branchChangesScript, branchesScript, checkoutScript, commitDetailScript, commitScript,
  conflictStagesScript, createBranchScript, discardScript, fileAtRefScript, gitBaseEnv,
  grepScript, logScript, pullScript, pushScript, resolveConflictScript, stageScript,
  statusScript, treeScript, type GitScript
} from './scripts.js'

/** Что сервису нужно от реестра машин — ровно это, чтобы тесты не поднимали агента. */
export interface GitRuntime {
  exec(
    agentId: string,
    command: string,
    timeoutMs: number,
    signal?: AbortSignal,
    meta?: { source: 'console'; userId?: string }
  ): Promise<{ output: string; exitCode: number | null; timedOut: boolean }>
  fsRead(agentId: string, path: string): Promise<FsResult>
  fsWrite(agentId: string, path: string, dataBase64: string): Promise<FsResult>
  isOnline(agentId: string): boolean
  policyOf(agentId: string): AgentPolicy | undefined
  platformOf(agentId: string): string | undefined
  nameOf(agentId: string): string | undefined
}

export interface GitWorkspaceDeps {
  db: VoiceChatDb
  runtime: GitRuntime
  /** Гейт команд проекта и роли: deny-паттерны обязаны действовать и на наш git. */
  gate?: CommandGate
  now?: () => number
}

/** Ошибка с кодом для REST: сообщение уже человеческое. */
export class GitError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

const READ_TIMEOUT_MS = 30_000
const MUTATE_TIMEOUT_MS = 120_000
const NETWORK_TIMEOUT_MS = 300_000

/** Последняя содержательная строка вывода: именно её показываем человеку. */
function lastLine(output: string): string {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines.length ? lines[lines.length - 1] : ''
}

/** Соединение путей с учётом разделителя машины (на Windows агент ждёт `\`). */
export function joinMachinePath(base: string, relative: string, platform?: string): string {
  const separator = platform === 'win32' ? '\\' : '/'
  const root = base.replace(/[\\/]+$/, '')
  const tail = platform === 'win32' ? relative.replace(/\//g, '\\') : relative
  return `${root}${separator}${tail}`
}

/** Похоже ли содержимое на бинарное: NUL или сбойный UTF-8 (тот же критерий, что у проводника). */
export function looksBinary(text: string): boolean {
  return text.includes('\u0000') || text.includes('\uFFFD')
}

export class GitWorkspaceService {
  private readonly locks = new Set<string>()

  constructor(private readonly deps: GitWorkspaceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /**
   * Рабочие копии проекта: активные CI-workspace задач, их dev-копии и merge-клоны,
   * плюс общая папка проекта на машине. Ни одного обращения к машине — только БД,
   * поэтому список открывается мгновенно даже там, где машины офлайн.
   */
  listWorkspaces(userId: string, projectId: string): GitWorkspaceRef[] {
    const project = this.deps.db.getProject(userId, projectId)
    if (!project) throw new GitError(404, 'not_found', 'Проект не найден')
    const refs: GitWorkspaceRef[] = []
    const seen = new Set<string>()
    const add = (ref: GitWorkspaceRef | null): void => {
      if (!ref) return
      const key = `${ref.agentId}::${ref.path}`
      if (seen.has(key)) return
      seen.add(key)
      refs.push(ref)
    }
    for (const workspace of this.deps.db.listCiWorkspaceReport(userId, projectId)) {
      if (!workspace.agentId) continue
      add(this.refFromCiWorkspace(userId, project, workspace.id))
    }
    for (const task of this.deps.db.getBoard(userId, projectId)?.tasks ?? []) {
      for (const repository of this.deps.db.listTaskRepositories(userId, projectId, task.id)) {
        if (repository.state !== 'active') continue
        add(this.refFromTaskRepository(userId, project, repository.id))
      }
    }
    const defaultAgent = project.defaultAgentId
    if (defaultAgent) add(this.refFromProjectMachine(userId, project, defaultAgent))
    return refs
  }

  /**
   * Резолвер цели. `write: true` дополнительно требует, чтобы каталог был свободен и
   * машина позволяла запись: иначе операция отклоняется до похода на машину.
   */
  resolve(userId: string, projectId: string, workspaceId: string, opts: { write: boolean }): GitWorkspaceRef {
    const project = this.deps.db.getProject(userId, projectId)
    if (!project) throw new GitError(404, 'not_found', 'Проект не найден')
    const parsed = parseGitWorkspaceId(workspaceId)
    if (!parsed) throw new GitError(404, 'workspace_not_found', 'Рабочая копия не найдена')
    const ref = parsed.kind === 'ci-workspace'
      ? this.refFromCiWorkspace(userId, project, parsed.ciWorkspaceId)
      : parsed.kind === 'task-repository'
        ? this.refFromTaskRepository(userId, project, parsed.taskRepositoryId)
        : parsed.kind === 'conversation'
          ? this.refFromConversation(userId, project, parsed.conversationId)
          : this.refFromProjectMachine(userId, project, parsed.agentId)
    if (!ref) throw new GitError(404, 'workspace_not_found', 'Рабочая копия не найдена')
    if (!ref.path) throw new GitError(409, 'path_missing', 'У рабочей копии не задан каталог')
    if (!ref.online) throw new GitError(409, 'machine_offline', 'Машина не в сети')
    if (!opts.write) return ref
    if (ref.released) throw new GitError(409, 'workspace_released', 'Рабочая копия удалена cleanup-шагом рана')
    if (ref.busy) {
      throw new GitError(409, 'workspace_busy', ref.busy.kind === 'ci'
        ? 'Каталог занят активным CI-раном задачи'
        : 'Каталог занят активным merge-раном задачи')
    }
    if (ref.kind === 'merge-clone') throw new GitError(403, 'read_only_workspace', 'Merge-клон доступен только для чтения')
    if (!ref.writable) throw new GitError(403, 'read_only_machine', ref.readOnlyReason ?? 'Изменение рабочей копии запрещено')
    return ref
  }

  /** Состояние рабочей копии. Проблема — не исключение: панели нужно её нарисовать. */
  async status(userId: string, projectId: string, workspaceId: string): Promise<GitWorkspaceStatus> {
    let ref: GitWorkspaceRef
    try {
      ref = this.resolve(userId, projectId, workspaceId, { write: false })
    } catch (error) {
      if (error instanceof GitError && error.status === 409) {
        return this.emptyStatus(userId, projectId, null, error.code as GitWorkspaceProblem, error.message)
      }
      throw error
    }
    if (ref.released) return this.emptyStatus(userId, projectId, ref, 'workspace_released', null)
    const baseBranch = this.deps.db.getProject(userId, projectId)?.ciBaseBranch ?? 'main'
    const result = await this.run(userId, projectId, ref, statusScript(baseBranch), READ_TIMEOUT_MS)
    const sections = splitGitSections(result.output)
    if (!sections.repo || !/true/.test(sections.repo)) {
      return this.emptyStatus(userId, projectId, ref, 'not_a_repository', lastLine(sections.repo ?? result.output))
    }
    const head = /^[0-9a-f]{7,40}$/.exec(lastLine(sections.head ?? ''))?.[0] ?? null
    const porcelain = decodeBase64Section(sections.status_b64)
    const parsed = parseGitStatusPorcelain(porcelain, GIT_MAX_CHANGES)
    const upstreamRaw = lastLine(sections.upstream ?? '')
    const upstream = upstreamRaw && !/^fatal|^error|no upstream/i.test(upstreamRaw) ? upstreamRaw : parsed.head.upstream
    const track = parseAheadBehind(sections.track ?? '')
    const fromHeader = { ahead: parsed.head.ahead, behind: parsed.head.behind }
    const counts = track.ahead || track.behind ? track : fromHeader
    return {
      ref,
      problem: null,
      detail: null,
      gitUrl: this.deps.db.getProject(userId, projectId)?.gitUrl ?? null,
      baseBranch,
      branch: parsed.head.branch,
      detached: parsed.head.detached || (!parsed.head.branch && head !== null),
      head,
      upstream: upstream ?? null,
      ahead: counts.ahead,
      behind: counts.behind,
      changes: parsed.changes,
      changesTruncated: parsed.truncated,
      commitsAhead: parseGitLog(sections.commits ?? ''),
      mergeBase: /^[0-9a-f]{40}$/.exec(lastLine(sections.mergebase ?? ''))?.[0] ?? null
    }
  }

  /** Локальные и удалённые ветки; `refresh` — с обращением к origin. */
  async branches(userId: string, projectId: string, workspaceId: string, refresh: boolean): Promise<GitBranchList> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: false })
    const result = await this.run(
      userId, projectId, ref, branchesScript(refresh), refresh ? NETWORK_TIMEOUT_MS : READ_TIMEOUT_MS
    )
    const sections = splitGitSections(result.output)
    if (refresh && result.exitCode !== 0 && !sections.refs) {
      throw new GitError(409, 'git_failed', lastLine(result.output) || 'Не удалось обновить список ветвей')
    }
    return {
      current: lastLine(sections.current ?? '') || null,
      branches: parseGitRefs(sections.refs ?? ''),
      fetchedAt: refresh ? this.now() : null
    }
  }

  /** Один уровень дерева файлов ревизии. */
  async tree(userId: string, projectId: string, workspaceId: string, dir: string, refName?: string): Promise<GitTreeListing> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: false })
    const revision = refName ?? 'HEAD'
    if (!isValidGitRef(revision)) throw new GitError(400, 'invalid_ref', 'Недопустимая ревизия')
    if (dir && !isSafeRepoRelativePath(dir)) throw new GitError(400, 'invalid_path', 'Недопустимый путь каталога')
    const result = await this.run(userId, projectId, ref, treeScript(revision, dir), READ_TIMEOUT_MS)
    const sections = splitGitSections(result.output)
    const listing = decodeBase64Section(sections.tree_b64)
    if (!listing.trim() && result.exitCode !== 0) {
      throw new GitError(409, 'git_failed', lastLine(result.output) || 'Не удалось прочитать дерево файлов')
    }
    return { ref: revision, dir, entries: parseGitLsTree(listing, dir) }
  }

  /**
   * Байты файла как есть — для скачивания бинарника или файла сверх лимита показа.
   * Отдаётся base64: канал текстовый, и «просто отдать содержимое» его бы испортило.
   */
  async fileBytes(userId: string, projectId: string, workspaceId: string, path: string): Promise<{ path: string; dataBase64: string; size: number }> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: false })
    if (!isSafeRepoRelativePath(path)) throw new GitError(400, 'invalid_path', 'Недопустимый путь файла')
    const absolute = joinMachinePath(ref.path, path, this.deps.runtime.platformOf(ref.agentId))
    const result = await this.deps.runtime.fsRead(ref.agentId, absolute)
    const data = result.dataBase64 ?? ''
    return { path, dataBase64: data, size: Buffer.from(data, 'base64').byteLength }
  }

  /** Содержимое файла: из ревизии (`ref`) или из рабочей копии (`ref` не задан). */
  async file(userId: string, projectId: string, workspaceId: string, path: string, refName?: string): Promise<GitFileContent> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: false })
    if (!isSafeRepoRelativePath(path)) throw new GitError(400, 'invalid_path', 'Недопустимый путь файла')
    if (refName && !isValidGitRef(refName)) throw new GitError(400, 'invalid_ref', 'Недопустимая ревизия')
    return refName
      ? await this.fileAtRef(userId, projectId, ref, path, refName)
      : await this.workingFile(ref, path)
  }

  /**
   * Две версии файла для сравнения. Парсер unified diff не нужен: Monaco считает
   * разницу сам, зато правая сторона — живой файл, который тут же правится.
   */
  async diff(userId: string, projectId: string, workspaceId: string, path: string, base?: string): Promise<GitFileDiff> {
    const status = await this.status(userId, projectId, workspaceId)
    if (status.problem) throw new GitError(409, status.problem, status.detail ?? 'Рабочая копия недоступна')
    const change = status.changes.find((item) => item.path === path)
    const state = change?.state ?? 'modified'
    const revision = base ?? 'HEAD'
    if (!isValidGitRef(revision)) throw new GitError(400, 'invalid_ref', 'Недопустимая ревизия')
    if (!isSafeRepoRelativePath(path)) throw new GitError(400, 'invalid_path', 'Недопустимый путь файла')
    const ref = status.ref!
    // Новый файл слева пуст, удалённый — пуст справа: спрашивать git о них незачем.
    const original = state === 'untracked'
      ? null
      : await this.fileAtRef(userId, projectId, ref, change?.oldPath ?? path, revision).catch(() => null)
    const modified = state === 'deleted' ? null : await this.workingFile(ref, path).catch(() => null)
    return { path, oldPath: change?.oldPath ?? null, state, original, modified }
  }

  /**
   * Запись файла. Идёт через fs-канал агента (он уважает `allowWrite` и `allowedDirs`
   * на самой машине), но только после проверок панели: право, свободный каталог и путь
   * внутри репозитория. Прямой `window.fs.write` из UI всех трёх проверок не проходит.
   */
  async saveFile(userId: string, projectId: string, workspaceId: string, path: string, content: string): Promise<GitSaveFileResult> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: true })
    if (!isSafeRepoRelativePath(path)) throw new GitError(400, 'invalid_path', 'Недопустимый путь файла')
    const absolute = joinMachinePath(ref.path, path, this.deps.runtime.platformOf(ref.agentId))
    const data = Buffer.from(content, 'utf8')
    if (data.byteLength > GIT_TEXT_MAX_BYTES) throw new GitError(400, 'file_too_large', 'Файл больше допустимого размера для правки')
    await this.deps.runtime.fsWrite(ref.agentId, absolute, data.toString('base64'))
    this.audit(userId, projectId, ref, 'git.save_file', { path })
    const status = await this.status(userId, projectId, workspaceId)
    return {
      file: { path, ref: null, content, size: data.byteLength, truncated: false, binary: false },
      status
    }
  }

  /**
   * Переключение ветки. Грязное дерево без явного согласия — отказ: человек должен
   * увидеть, что именно у него не закоммичено, а не узнать об этом из вывода git.
   */
  async checkout(userId: string, projectId: string, workspaceId: string, branch: string, confirmDirty: boolean): Promise<GitCheckoutResult> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: true })
    if (!isValidGitBranchName(branch)) throw new GitError(400, 'invalid_branch', 'Недопустимое имя ветки')
    const before = await this.status(userId, projectId, workspaceId)
    if (before.changes.length > 0 && !confirmDirty) {
      throw new GitError(409, 'dirty_worktree', `В рабочей копии ${before.changes.length} незакоммиченных изменений`)
    }
    const result = await this.runMutation(userId, projectId, ref, checkoutScript(branch), MUTATE_TIMEOUT_MS, 'Не удалось переключить ветку')
    const sections = splitGitSections(result.output)
    this.audit(userId, projectId, ref, 'git.checkout', { branch })
    return {
      status: await this.status(userId, projectId, workspaceId),
      createdLocal: /remote/.test(sections.mode ?? '')
    }
  }

  /** Новая ветка от текущего HEAD (или от указанной точки). */
  async createBranch(userId: string, projectId: string, workspaceId: string, name: string, from?: string): Promise<GitCheckoutResult> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: true })
    if (!isValidGitBranchName(name)) throw new GitError(400, 'invalid_branch', 'Недопустимое имя ветки')
    const point = from ?? 'HEAD'
    if (!isValidGitRef(point)) throw new GitError(400, 'invalid_ref', 'Недопустимая точка ветвления')
    await this.runMutation(userId, projectId, ref, createBranchScript(name, point), MUTATE_TIMEOUT_MS, 'Не удалось создать ветку')
    this.audit(userId, projectId, ref, 'git.branch', { branch: name, from: point })
    return { status: await this.status(userId, projectId, workspaceId), createdLocal: true }
  }

  /**
   * Коммит от имени человека. После него обязательно обновляем `ci_workspaces`: merge-ран
   * берёт SHA оттуда, и без записи он слил бы не то, что человек закоммитил.
   */
  async commit(
    userId: string, projectId: string, workspaceId: string,
    input: { message: string; paths?: string[]; all?: boolean }
  ): Promise<GitCommitResult> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: true })
    const message = normalizeCommitMessage(input.message)
    if (!message) throw new GitError(400, 'invalid_message', 'Сообщение коммита пустое или слишком длинное')
    const all = input.all === true
    const paths = (input.paths ?? []).filter((path) => path.length > 0)
    if (!all && paths.length === 0) throw new GitError(400, 'nothing_to_commit', 'Не выбрано ни одного файла')
    for (const path of paths) {
      if (!isSafeRepoRelativePath(path)) throw new GitError(400, 'invalid_path', `Недопустимый путь: ${path}`)
    }
    const before = await this.status(userId, projectId, workspaceId)
    if (before.changes.length === 0) throw new GitError(409, 'nothing_to_commit', 'В рабочей копии нет изменений')
    const user = this.deps.db.getUser(userId)
    const script = commitScript({
      message, paths, all,
      user: userId,
      email: user?.email || `${userId}@users.noreply.voicechat`
    })
    const result = await this.runMutation(userId, projectId, ref, script, MUTATE_TIMEOUT_MS, 'Не удалось создать коммит')
    const sections = splitGitSections(result.output)
    const sha = /^[0-9a-f]{7,40}$/.exec(lastLine(sections.sha ?? ''))?.[0]
    if (!sha) throw new GitError(409, 'git_failed', lastLine(result.output) || 'Коммит не создан')
    const status = await this.status(userId, projectId, workspaceId)
    this.recordRevision(ref, status.branch, sha, false)
    this.audit(userId, projectId, ref, 'git.commit', { sha, files: all ? before.changes.length : paths.length })
    return { status, sha, staged: all ? before.changes.length : paths.length }
  }

  /**
   * Отправка ветки в origin. В `main`/`master`/`release/*` панель не пушит: туда ведут
   * merge-ран и релизы со своими гейтами, и дублировать их здесь — значит обойти их.
   */
  async push(userId: string, projectId: string, workspaceId: string, branchInput?: string): Promise<GitPushResult> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: true })
    const before = await this.status(userId, projectId, workspaceId)
    const branch = branchInput ?? before.branch
    if (!branch) throw new GitError(409, 'detached_head', 'HEAD не на ветке: сначала переключитесь на ветку')
    if (!isValidGitBranchName(branch)) throw new GitError(400, 'invalid_branch', 'Недопустимое имя ветки')
    if (isProtectedGitBranch(branch)) {
      throw new GitError(403, 'protected_branch', `Ветка ${branch} защищена: в неё попадают только через merge-ран и релизы`)
    }
    const result = await this.runMutation(userId, projectId, ref, pushScript(branch), NETWORK_TIMEOUT_MS, 'Не удалось отправить ветку')
    const sections = splitGitSections(result.output)
    const head = /^[0-9a-f]{40}$/.exec(lastLine(sections.head ?? ''))?.[0] ?? null
    const remote = /^[0-9a-f]{40}$/.exec(lastLine(sections.remote ?? ''))?.[0] ?? null
    if (!head || !remote || head !== remote) {
      throw new GitError(409, 'push_not_confirmed', 'В origin не оказалось отправленного коммита: повторите отправку')
    }
    this.recordRevision(ref, branch, head, true)
    this.registerRepository(ref)
    this.audit(userId, projectId, ref, 'git.push', { branch, sha: head })
    return { status: await this.status(userId, projectId, workspaceId), branch, sha: head }
  }

  /**
   * Подтянуть origin в текущую ветку. Нужен, потому что без него отказ push с
   * `non-fast-forward` был тупиком: единственным выходом оставался терминал.
   *
   * Требует чистого дерева: rebase поверх незакоммиченных правок либо откажется, либо
   * потребует stash — и то и другое человек должен решить сам, видя список файлов.
   */
  async pull(userId: string, projectId: string, workspaceId: string, mode: GitPullMode = 'rebase'): Promise<GitPullResult> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: true })
    const before = await this.status(userId, projectId, workspaceId)
    if (!before.branch) throw new GitError(409, 'detached_head', 'HEAD не на ветке: сначала переключитесь на ветку')
    if (before.changes.length > 0) {
      throw new GitError(409, 'dirty_worktree', `Сначала закоммитьте или отбросьте изменения (${before.changes.length})`)
    }
    const result = await this.runMutation(
      userId, projectId, ref, pullScript(before.branch, mode), NETWORK_TIMEOUT_MS, 'Не удалось подтянуть изменения'
    )
    const sections = splitGitSections(result.output)
    if (/no-upstream/.test(sections.combine ?? '')) {
      throw new GitError(409, 'unknown_ref', `Ветки ${before.branch} нет в origin — сначала отправьте её`)
    }
    const status = await this.status(userId, projectId, workspaceId)
    this.audit(userId, projectId, ref, 'git.pull', { branch: before.branch, mode })
    return { status, mode, pulled: Math.max(0, before.behind) }
  }

  /**
   * Отбросить правки в выбранных файлах — единственная необратимая операция панели.
   * Поэтому подтверждение приходит от клиента текстом (`confirmText` = имя ветки),
   * и сервер сверяет его сам: иначе «отбросить всё» отделяло бы от случайного клика
   * только модальное окно в браузере.
   */
  async discard(
    userId: string, projectId: string, workspaceId: string, paths: string[], confirmText: string
  ): Promise<GitDiscardResult> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: true })
    const before = await this.status(userId, projectId, workspaceId)
    const expected = before.branch ?? before.head?.slice(0, 8) ?? ''
    if (!expected || confirmText.trim() !== expected) {
      throw new GitError(409, 'confirmation_mismatch', `Для подтверждения введите «${expected}»`)
    }
    const chosen = paths.filter((path) => path.length > 0)
    if (chosen.length === 0) throw new GitError(400, 'nothing_to_discard', 'Не выбрано ни одного файла')
    for (const path of chosen) {
      if (!isSafeRepoRelativePath(path)) throw new GitError(400, 'invalid_path', `Недопустимый путь: ${path}`)
      if (!before.changes.some((change) => change.path === path)) {
        throw new GitError(409, 'nothing_to_discard', `Файл ${path} не изменён — отбрасывать нечего`)
      }
    }
    const untracked = chosen.filter((path) => before.changes.find((change) => change.path === path)?.state === 'untracked')
    await this.runMutation(userId, projectId, ref, discardScript(chosen), MUTATE_TIMEOUT_MS, 'Не удалось отбросить правки')
    this.audit(userId, projectId, ref, 'git.discard', { files: chosen.length, untracked: untracked.length })
    return {
      status: await this.status(userId, projectId, workspaceId),
      reverted: chosen.length - untracked.length,
      removed: untracked.length
    }
  }

  /**
   * Что ветка меняет относительно базы (`merge-base` с origin/<base>), а не только
   * незакоммиченное. Именно этот вид нужен, когда смотрят работу модели за ран:
   * коммиты уже сделаны, и рабочее дерево чистое.
   */
  async branchChanges(userId: string, projectId: string, workspaceId: string, base?: string): Promise<GitBranchChanges> {
    const status = await this.status(userId, projectId, workspaceId)
    if (status.problem) throw new GitError(409, status.problem, status.detail ?? 'Рабочая копия недоступна')
    const from = base ?? status.mergeBase
    if (!from) throw new GitError(409, 'unknown_ref', `Нет общего предка с origin/${status.baseBranch}: подтяните origin`)
    if (!isValidGitRef(from)) throw new GitError(400, 'invalid_ref', 'Недопустимая ревизия сравнения')
    const result = await this.run(userId, projectId, status.ref!, branchChangesScript(from), READ_TIMEOUT_MS)
    const parsed = parseGitNameStatus(decodeBase64Section(splitGitSections(result.output).names_b64), GIT_MAX_CHANGES)
    return { base: from, changes: parsed.changes, truncated: parsed.truncated }
  }

  /** Индексация и снятие с индекса: коммит выбранного не должен зависеть от чужого индекса. */
  async stage(userId: string, projectId: string, workspaceId: string, paths: string[], unstage: boolean): Promise<GitWorkspaceStatus> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: true })
    const chosen = paths.filter((path) => path.length > 0)
    if (chosen.length === 0) throw new GitError(400, 'bad_request', 'Не выбрано ни одного файла')
    for (const path of chosen) {
      if (!isSafeRepoRelativePath(path)) throw new GitError(400, 'invalid_path', `Недопустимый путь: ${path}`)
    }
    await this.runMutation(userId, projectId, ref, stageScript(chosen, unstage), MUTATE_TIMEOUT_MS, 'Не удалось изменить индекс')
    this.audit(userId, projectId, ref, unstage ? 'git.unstage' : 'git.stage', { files: chosen.length })
    return await this.status(userId, projectId, workspaceId)
  }

  /** История ветки или одного файла. */
  async log(userId: string, projectId: string, workspaceId: string, path?: string, limit: number = GIT_MAX_LOG): Promise<{ commits: ReturnType<typeof parseGitLog> }> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: false })
    if (path && !isSafeRepoRelativePath(path)) throw new GitError(400, 'invalid_path', 'Недопустимый путь файла')
    const bounded = Math.max(1, Math.min(limit, GIT_MAX_LOG))
    const result = await this.run(userId, projectId, ref, logScript(bounded, path ?? ''), READ_TIMEOUT_MS)
    return { commits: parseGitLog(splitGitSections(result.output).log ?? '') }
  }

  /** Что в коммите: метаданные и список файлов. */
  async commitDetail(userId: string, projectId: string, workspaceId: string, sha: string): Promise<GitCommitDetail> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: false })
    if (!isValidGitRef(sha)) throw new GitError(400, 'invalid_ref', 'Недопустимая ревизия')
    const result = await this.run(userId, projectId, ref, commitDetailScript(sha), READ_TIMEOUT_MS)
    const sections = splitGitSections(result.output)
    const meta = parseGitLog(sections.meta ?? '')[0]
    if (!meta) throw new GitError(409, 'unknown_ref', lastLine(result.output) || 'Коммит не найден')
    const parsed = parseGitNameStatus(decodeBase64Section(sections.names_b64), GIT_MAX_CHANGES)
    return { ...meta, files: parsed.changes.map(({ path, oldPath, state }) => ({ path, oldPath, state })), truncated: parsed.truncated }
  }

  /** Поиск по содержимому рабочей копии. */
  async grep(userId: string, projectId: string, workspaceId: string, query: string, limit: number = GIT_MAX_GREP): Promise<GitGrepResult> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: false })
    const needle = query.trim()
    if (needle.length < 2) throw new GitError(400, 'bad_request', 'Запрос короче двух символов')
    if (needle.length > 200) throw new GitError(400, 'bad_request', 'Запрос слишком длинный')
    const bounded = Math.max(1, Math.min(limit, GIT_MAX_GREP))
    const result = await this.run(userId, projectId, ref, grepScript(needle, bounded), READ_TIMEOUT_MS)
    // Пустой результат — не ошибка: git grep выходит с кодом 1, когда ничего не нашёл.
    const parsed = parseGitGrep(decodeBase64Section(splitGitSections(result.output).grep), bounded)
    return { query: needle, matches: parsed.matches, truncated: parsed.truncated }
  }

  /** Три стадии конфликта для трёхстороннего просмотра. */
  async conflict(userId: string, projectId: string, workspaceId: string, path: string): Promise<GitConflictStages> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: false })
    if (!isSafeRepoRelativePath(path)) throw new GitError(400, 'invalid_path', 'Недопустимый путь файла')
    const result = await this.run(userId, projectId, ref, conflictStagesScript(path), READ_TIMEOUT_MS)
    const sections = splitGitSections(result.output)
    const stage = (name: string, label: string): GitFileContent | null => {
      const text = decodeBase64Section(sections[name])
      if (!text) return null
      const binary = looksBinary(text)
      return { path, ref: label, content: binary ? '' : text, size: Buffer.byteLength(text), truncated: false, binary }
    }
    const stages = {
      path,
      base: stage('stage1_b64', ':1:'),
      ours: stage('stage2_b64', ':2:'),
      theirs: stage('stage3_b64', ':3:')
    }
    if (!stages.ours && !stages.theirs) {
      throw new GitError(409, 'not_conflicted', 'У файла нет конфликтных стадий — возможно, конфликт уже разрешён')
    }
    return stages
  }

  /** Оставить одну сторону конфликта. */
  async resolveConflict(userId: string, projectId: string, workspaceId: string, path: string, side: GitConflictSide): Promise<GitWorkspaceStatus> {
    const ref = this.resolve(userId, projectId, workspaceId, { write: true })
    if (!isSafeRepoRelativePath(path)) throw new GitError(400, 'invalid_path', 'Недопустимый путь файла')
    await this.runMutation(userId, projectId, ref, resolveConflictScript(path, side), MUTATE_TIMEOUT_MS, 'Не удалось разрешить конфликт')
    this.audit(userId, projectId, ref, 'git.resolve', { path, side })
    return await this.status(userId, projectId, workspaceId)
  }

  // --- внутреннее ---------------------------------------------------------

  private async fileAtRef(userId: string, projectId: string, ref: GitWorkspaceRef, path: string, revision: string): Promise<GitFileContent> {
    const result = await this.run(userId, projectId, ref, fileAtRefScript(revision, path), READ_TIMEOUT_MS)
    const sections = splitGitSections(result.output)
    const size = Number(lastLine(sections.size ?? ''))
    if (!Number.isFinite(size)) {
      throw new GitError(409, 'git_failed', lastLine(result.output) || 'Файл не найден в ревизии')
    }
    const raw = Buffer.from((sections.content_b64 ?? '').trim(), 'base64')
    const content = raw.toString('utf8')
    const binary = looksBinary(content)
    return {
      path,
      ref: revision,
      content: binary ? '' : content,
      size,
      truncated: size > GIT_TEXT_MAX_BYTES,
      binary
    }
  }

  private async workingFile(ref: GitWorkspaceRef, path: string): Promise<GitFileContent> {
    const absolute = joinMachinePath(ref.path, path, this.deps.runtime.platformOf(ref.agentId))
    const result = await this.deps.runtime.fsRead(ref.agentId, absolute)
    const raw = Buffer.from(result.dataBase64 ?? '', 'base64')
    const truncated = raw.byteLength > GIT_TEXT_MAX_BYTES
    const content = truncated ? '' : raw.toString('utf8')
    const binary = !truncated && looksBinary(content)
    return {
      path,
      ref: null,
      content: binary ? '' : content,
      size: raw.byteLength,
      truncated,
      binary
    }
  }

  /** Выполнить скрипт на машине: гейт команд, единый env, разбор ошибок транспорта. */
  private async run(
    userId: string, projectId: string, ref: GitWorkspaceRef, script: GitScript, timeoutMs: number
  ): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
    const command = buildShellCommand(script.script, ref.path, { ...gitBaseEnv(), ...script.env })
    const verdict = this.deps.gate?.({ command, userId, projectId, source: 'console' })
    if (verdict && !verdict.allowed) {
      throw new GitError(403, 'command_denied', `Запрещено политикой команд: ${verdict.reason ?? 'нет доступа'}`)
    }
    const key = `${ref.agentId}::${ref.path}`
    if (this.locks.has(key)) throw new GitError(409, 'git_busy', 'Другая операция в этой рабочей копии ещё выполняется')
    this.locks.add(key)
    try {
      const result = await this.deps.runtime.exec(ref.agentId, command, timeoutMs, undefined, { source: 'console', userId })
      if (result.timedOut) throw new GitError(409, 'git_timeout', 'Команда git не завершилась за отведённое время')
      return result
    } catch (error) {
      if (error instanceof GitError) throw error
      throw new GitError(409, 'machine_error', error instanceof Error ? error.message : String(error))
    } finally {
      this.locks.delete(key)
    }
  }

  /** То же, но с проверкой кода возврата и переводом типовых отказов git в коды. */
  private async runMutation(
    userId: string, projectId: string, ref: GitWorkspaceRef, script: GitScript, timeoutMs: number, fallback: string
  ): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
    const result = await this.run(userId, projectId, ref, script, timeoutMs)
    if (result.exitCode === 0) return result
    const message = lastLine(result.output) || fallback
    if (/would be overwritten|local changes/i.test(result.output)) throw new GitError(409, 'dirty_worktree', message)
    if (/non-fast-forward|\[rejected\]|failed to push/i.test(result.output)) throw new GitError(409, 'push_rejected', message)
    if (/authentication failed|could not read Username|terminal prompts disabled|Permission denied/i.test(result.output)) {
      throw new GitError(409, 'git_credentials_missing', message)
    }
    if (/index\.lock/i.test(result.output)) throw new GitError(409, 'git_locked', message)
    if (/nothing to commit/i.test(result.output)) throw new GitError(409, 'nothing_to_commit', message)
    throw new GitError(409, 'git_failed', message)
  }

  private emptyStatus(
    userId: string, projectId: string, ref: GitWorkspaceRef | null, problem: GitWorkspaceProblem, detail: string | null
  ): GitWorkspaceStatus {
    const project = this.deps.db.getProject(userId, projectId)
    return {
      ref, problem, detail,
      gitUrl: project?.gitUrl ?? null,
      baseBranch: project?.ciBaseBranch ?? 'main',
      branch: null, detached: false, head: null, upstream: null,
      ahead: 0, behind: 0, changes: [], changesTruncated: false, commitsAhead: [], mergeBase: null
    }
  }

  /** Ветка и SHA рабочей копии в БД: их читает merge-ран, поэтому запись обязательна. */
  private recordRevision(ref: GitWorkspaceRef, branch: string | null, sha: string, pushed: boolean): void {
    if (ref.kind !== 'task-workspace' || !ref.id.startsWith('ws:') || !branch) return
    this.deps.db.updateCiWorkspaceRevision(ref.id.slice(3), branch, sha, pushed)
  }

  /** Регистрируем копию как dev-workspace задачи — то же делает merge-ран. */
  private registerRepository(ref: GitWorkspaceRef): void {
    if (!ref.taskId) return
    this.deps.db.upsertTaskRepository(ref.projectId, ref.taskId, ref.agentId, ref.path, 'dev-workspace')
  }

  private audit(userId: string, projectId: string, ref: GitWorkspaceRef, type: string, payload: Record<string, unknown>): void {
    this.deps.db.addCiEvent({
      projectId, type, actorType: 'user', actorId: userId,
      payload: { ...payload, workspace: ref.id, path: ref.path, agentId: ref.agentId }
    })
    // Второй адресат — журнал безопасности: операция меняет рабочую копию на чужом
    // хосте, и владелец машины должен видеть её там же, где входы и подключения
    // агентов, а не только в событиях проекта.
    const details = [type, ref.path, ...Object.entries(payload).map(([key, value]) => `${key}=${String(value)}`)].join(' · ')
    this.deps.db.logSecurityEvent({ user: userId, type: 'git_workspace_mutation', details })
  }

  private machineAccess(userId: string, project: { id: string; machines: { agentId: string; ownership?: string; sharedWithProject?: boolean }[] }, agentId: string):
    { online: boolean; writable: boolean; readOnlyReason: string | null; machineName: string | null } | null {
    const linked = project.machines.some((machine) => machine.agentId === agentId)
    if (!linked && !this.deps.db.canUseAgent(userId, agentId, project.id)) return null
    if (!this.deps.db.canUseAgent(userId, agentId, project.id)) return null
    const policy = this.deps.runtime.policyOf(agentId)
    // Три независимых условия, и ни одно не перекрывает другое: полномочие роли,
    // режим доступа машины проекту и её собственная политика записи. UI получает
    // готовый флаг с причиной — иначе он показывал бы активную кнопку, а отказ
    // приходил бы тостом уже после клика.
    const role = this.deps.db.getUser(userId)?.role
    const permitted = role ? hasProjectPermission(role, 'repository:write') : false
    const shared = this.deps.db.canWriteAgent(userId, agentId, project.id)
    const policyAllows = policy?.allowWrite !== false
    return {
      online: this.deps.runtime.isOnline(agentId),
      writable: permitted && shared && policyAllows,
      readOnlyReason: !permitted
        ? 'Ваша роль не позволяет менять рабочую копию'
        : !shared
          ? 'Машина предоставлена проекту только для чтения'
          : !policyAllows
            ? 'Политика машины запрещает изменение файлов'
            : null,
      machineName: this.deps.runtime.nameOf(agentId) ?? null
    }
  }

  private busyFor(userId: string, projectId: string, taskId: string | null): GitWorkspaceRef['busy'] {
    if (!taskId) return null
    const ci = this.deps.db.activeCiRunForTask(taskId)
    if (ci) return { kind: 'ci', runId: ci.id, status: ci.status }
    const task = this.deps.db.getTaskDetail(userId, projectId, taskId)
    const mergeRunId = task?.activeMergeRunId ?? null
    return mergeRunId ? { kind: 'merge', runId: mergeRunId, status: 'running' } : null
  }

  private refFromCiWorkspace(userId: string, project: { id: string; machines: { agentId: string }[] }, workspaceId: string): GitWorkspaceRef | null {
    const workspace = this.deps.db.getCiWorkspaceById(workspaceId)
    if (!workspace || workspace.projectId !== project.id || !workspace.agentId) return null
    const access = this.machineAccess(userId, project, workspace.agentId)
    if (!access) return null
    const task = this.deps.db.getTaskDetail(userId, project.id, workspace.taskId)
    return {
      id: buildGitWorkspaceId({ kind: 'ci-workspace', ciWorkspaceId: workspace.id }),
      kind: 'task-workspace',
      projectId: project.id,
      taskId: workspace.taskId,
      taskTitle: task?.title ?? null,
      taskSeq: task?.seq ?? null,
      conversationId: null,
      agentId: workspace.agentId,
      machineName: access.machineName,
      path: workspace.path,
      expectedBranch: workspace.branch,
      expectedSha: workspace.commitSha,
      pushed: workspace.pushed,
      online: access.online,
      writable: access.writable,
      readOnlyReason: access.readOnlyReason,
      busy: this.busyFor(userId, project.id, workspace.taskId),
      released: workspace.state === 'released'
    }
  }

  private refFromTaskRepository(userId: string, project: { id: string; machines: { agentId: string }[] }, repositoryId: string): GitWorkspaceRef | null {
    const repository = this.deps.db.getTaskRepositoryById(repositoryId)
    if (!repository || repository.projectId !== project.id) return null
    const access = this.machineAccess(userId, project, repository.agentId)
    if (!access) return null
    const task = this.deps.db.getTaskDetail(userId, project.id, repository.taskId)
    const workspace = this.deps.db.findActiveCiWorkspace(project.id, repository.taskId)
    return {
      id: buildGitWorkspaceId({ kind: 'task-repository', taskRepositoryId: repository.id }),
      kind: repository.kind === 'merge-clone' ? 'merge-clone' : 'task-workspace',
      projectId: project.id,
      taskId: repository.taskId,
      taskTitle: task?.title ?? null,
      taskSeq: task?.seq ?? null,
      conversationId: null,
      agentId: repository.agentId,
      machineName: access.machineName ?? repository.machineName,
      path: repository.path,
      expectedBranch: workspace?.path === repository.path ? workspace.branch : null,
      expectedSha: workspace?.path === repository.path ? workspace.commitSha : null,
      pushed: workspace?.path === repository.path ? workspace.pushed : null,
      online: access.online,
      writable: repository.kind === 'merge-clone' ? false : access.writable,
      readOnlyReason: repository.kind === 'merge-clone'
        ? 'Merge-клоном управляет merge-ран: он только для чтения'
        : access.readOnlyReason,
      busy: this.busyFor(userId, project.id, repository.taskId),
      released: repository.state === 'deleted'
    }
  }

  /**
   * Рабочая копия разговора. Managed-запись (`conversation_workspaces`) сервер пока не
   * заполняет, поэтому основной путь — legacy `conversations.workdir` + машина чата.
   */
  private refFromConversation(userId: string, project: { id: string; machines: { agentId: string }[] }, conversationId: string): GitWorkspaceRef | null {
    const conversation = this.deps.db.getConversation(userId, conversationId)
    if (!conversation) return null
    if (conversation.projectId && conversation.projectId !== project.id) return null
    const agentId = conversation.execTarget && conversation.execTarget !== 'none' ? conversation.execTarget : null
    const path = conversation.workspace?.path ?? conversation.workdir
    if (!agentId || !path) return null
    const access = this.machineAccess(userId, project, agentId)
    if (!access) return null
    return {
      id: buildGitWorkspaceId({ kind: 'conversation', conversationId }),
      kind: 'chat-workspace',
      projectId: project.id,
      taskId: null,
      taskTitle: conversation.title ?? null,
      taskSeq: null,
      conversationId,
      agentId,
      machineName: access.machineName,
      path,
      expectedBranch: conversation.workspace?.branch ?? null,
      expectedSha: conversation.workspace?.baseSha ?? null,
      pushed: null,
      online: access.online,
      writable: access.writable && conversation.workspace?.readOnly !== true,
      readOnlyReason: conversation.workspace?.readOnly === true
        ? 'Рабочий каталог разговора помечен как read-only'
        : access.readOnlyReason,
      busy: null,
      released: false
    }
  }

  /** Общая папка проекта на машине: та же, что берут релизы. */
  private refFromProjectMachine(userId: string, project: { id: string; machines: { agentId: string }[] }, agentId: string): GitWorkspaceRef | null {
    const machine = this.deps.db.getProjectMachine(project.id, agentId)
    if (!machine) return null
    const path = machine.directories?.projectWorkdir.path || machine.path
    if (!path) return null
    const access = this.machineAccess(userId, project, agentId)
    if (!access) return null
    return {
      id: buildGitWorkspaceId({ kind: 'project-machine', agentId }),
      kind: 'project-worktree',
      projectId: project.id,
      taskId: null,
      taskTitle: null,
      taskSeq: null,
      conversationId: null,
      agentId,
      machineName: access.machineName,
      path,
      expectedBranch: null,
      expectedSha: null,
      pushed: null,
      online: access.online,
      writable: access.writable,
      readOnlyReason: access.readOnlyReason,
      busy: null,
      released: false
    }
  }
}

/** base64-секция приходит одной строкой (`tr -d '\n'`); мусор до маркера отбрасываем. */
function decodeBase64Section(section: string | undefined): string {
  const value = (section ?? '').trim()
  if (!value) return ''
  const encoded = value.split('\n').map((line) => line.trim()).filter((line) => /^[A-Za-z0-9+/=]+$/.test(line)).join('')
  if (!encoded) return ''
  return Buffer.from(encoded, 'base64').toString('utf8')
}
