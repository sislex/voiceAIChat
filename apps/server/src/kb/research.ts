// Операция «Исследовать проект»: модель на машине проекта сканирует репозиторий,
// сверяет статьи раздела «Разработка проекта» с кодом и переписывает их.
//
// Устройство как у хуков CI (ci/modelHooks.ts): один ход инъектируемого
// LlmClient с проброшенным remote-bash MCP на машину проекта, ответ — JSON со
// статьями. Правку базы делает сервер (db.saveKbDocument), а не модель: так
// раздел и владелец статьи не зависят от того, что модель себе придумала.
//
// Прогон длинный, поэтому HTTP его не ждёт: состояние живёт в памяти процесса
// (как реестр ходов), UI опрашивает GET того же маршрута.

import type { KbResearchRun, ProjectDetail } from '@voicechat/shared'
import { DEFAULT_CI_CLAUDE_MODEL } from '@voicechat/shared'
import type { LlmClient, LlmHandle } from '../claude/types.js'
import type { VoiceChatDb } from '../db/database.js'
import { MAX_DOCUMENTS, parseResearchOutput, type ResearchDocument } from './modelDocs.js'
import { EMPTY_CHANGES, MAX_AFFECTED_DOCS, kbUpdatePrompt } from './codeUpdate.js'

export { parseResearchOutput }
export type { ResearchDocument }

/** Исследование репозитория — операция минут; дальше глушим CLI. */
const TIMEOUT_MS = 15 * 60 * 1000

export interface KbResearchDeps {
  db: VoiceChatDb
  claude: LlmClient
  codex: LlmClient
  /** База URL MCP remote-bash (с ?k=секрет); агент и cwd дописываются здесь. */
  mcpBaseUrl: string
  agentNameOf: (agentId: string) => string | undefined
  now?: () => number
  timeoutMs?: number
}

/** Промпт исследования: что известно сейчас и что должно оказаться в базе. */
export function researchPrompt(project: ProjectDetail, workdir: string, existing: Array<{ id: string; title: string; updatedAt: number }>): string {
  return [
    `Ты ведёшь базу знаний по разработке проекта «${project.name}».`,
    project.description ? `Описание проекта: ${project.description}` : '',
    `Репозиторий проекта — на этой машине, каталог: ${workdir}`,
    '',
    'Задача: просканировать репозиторий и привести раздел базы знаний «Разработка проекта» в соответствие с кодом.',
    'Читай код инструментом bash (ls, cat, grep, git log). Ничего в репозитории не меняй и не коммить.',
    '',
    existing.length
      ? `Статьи, которые уже есть (id — вернуть его же, если статью надо обновить):\n${existing.map((doc) => `- ${doc.id} · ${doc.title}`).join('\n')}`
      : 'Статей пока нет — напиши их с нуля.',
    '',
    'Правила текста статей (те же, что в docs/kb/kb-workflow.md):',
    '- факты, а не планы: пиши то, что верно в коде сейчас;',
    '- одна тема — одна статья; обзорную статью держи первой;',
    '- не дублируй код: вместо перечисления полей — ссылка на файл-источник;',
    '- пиши абзацами по подтемам, на русском языке, в Markdown;',
    '- в `areas` перечисли пути файлов/каталогов, за которыми следит статья.',
    '',
    `Верни ТОЛЬКО JSON без пояснений, не более ${MAX_DOCUMENTS} статей:`,
    '{"note":"что изменилось одной фразой","documents":[{"id":"id существующей статьи или пусто","title":"Заголовок","kind":"subsystem","tags":["..."],"areas":["path/to/file.ts"],"body":"# Заголовок\\n\\nТекст статьи"}]}'
  ]
    .filter(Boolean)
    .join('\n')
}

/** Машина проекта и рабочий каталог для исследования (дефолтная — приоритетнее). */
export function researchTarget(project: ProjectDetail): { agentId: string; workdir: string } | null {
  const machine = project.machines.find((item) => item.agentId === project.defaultAgentId) ?? project.machines[0]
  if (!machine) return null
  const workdir = machine.path || machine.reposRoot
  return workdir ? { agentId: machine.agentId, workdir } : null
}

export class KbResearchManager {
  private readonly runs = new Map<string, KbResearchRun>()
  private readonly handles = new Map<string, LlmHandle>()
  private readonly now: () => number
  private readonly timeoutMs: number

  constructor(private readonly deps: KbResearchDeps) {
    this.now = deps.now ?? (() => Date.now())
    this.timeoutMs = deps.timeoutMs ?? TIMEOUT_MS
  }

  get(projectId: string): KbResearchRun | null {
    return this.runs.get(projectId) ?? null
  }

  /**
   * Запускает прогон и сразу возвращает его состояние. Второй запуск на том же
   * проекте, пока идёт первый, отдаёт текущий прогон (кнопка в UI не плодит
   * параллельные CLI).
   */
  start(userId: string, project: ProjectDetail, opts: { sinceSha?: string } = {}): KbResearchRun {
    const current = this.runs.get(project.id)
    if (current?.state === 'running') return current
    const target = researchTarget(project)
    if (!target) throw new Error('У проекта нет машины с рабочей папкой — привяжите машину в настройках проекта')
    const sinceSha = (opts.sinceSha ?? '').trim()
    if (sinceSha && !/^[0-9a-zA-Z._/-]{4,64}$/.test(sinceSha)) throw new Error('Некорректный коммит для сверки')
    const run: KbResearchRun = {
      projectId: project.id,
      state: 'running',
      startedBy: userId,
      startedAt: this.now(),
      finishedAt: null,
      documents: [],
      note: '',
      sinceSha: sinceSha || null,
      error: null
    }
    this.runs.set(project.id, run)
    void this.execute(userId, project, target, run)
    return run
  }

  private finish(run: KbResearchRun, patch: Partial<KbResearchRun>): void {
    Object.assign(run, patch, { finishedAt: this.now() })
    this.handles.delete(run.projectId)
  }

  private async execute(userId: string, project: ProjectDetail, target: { agentId: string; workdir: string }, run: KbResearchRun): Promise<void> {
    const { db } = this.deps
    const existingDocs = db.kbDocuments({ scope: 'project', projectId: project.id })
    const existing = existingDocs.map((doc) => ({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt }))
    const config = db.getCiLlmConfig('project', project.id)
    const client = config?.provider === 'codex' ? this.deps.codex : this.deps.claude
    const model = config?.provider === 'codex' ? config.model : config?.model || DEFAULT_CI_CLAUDE_MODEL
    // Режим «по изменениям с коммита» переиспользует промпт шага CI-рана
    // (kb/codeUpdate.ts) — ручной фолбэк не должен расходиться с автоматикой.
    // Диф здесь заранее не собран: рабочая копия проекта общая, сервер в неё не
    // ходит, поэтому модель собирает `git diff` сама и файлы не правит.
    const prompt = run.sinceSha
      ? kbUpdatePrompt({
          projectName: project.name,
          workdir: target.workdir,
          baseLabel: run.sinceSha,
          changes: { ...EMPTY_CHANGES },
          affected: existingDocs.slice(0, MAX_AFFECTED_DOCS).map((doc) => ({ id: doc.id, title: doc.title, areas: doc.areas })),
          editFileTopics: false
        })
      : researchPrompt(project, target.workdir, existing)
    let text = ''
    const answer = await new Promise<{ ok: boolean; text: string; error?: string }>((resolve) => {
      let settled = false
      const done = (result: { ok: boolean; text: string; error?: string }): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        try {
          this.handles.get(run.projectId)?.cancel()
        } catch {
          /* процесс уже мёртв */
        }
        done({ ok: false, text, error: 'Исследование не уложилось в отведённое время' })
      }, this.timeoutMs)
      const handle = client.send(
        {
          userId,
          prompt,
          sessionId: null,
          model,
          // Читаем чужой репозиторий: правки и коммиты модели здесь не нужны.
          readOnlyRemote: true,
          remote: {
            mcpUrl: `${this.deps.mcpBaseUrl}&agent=${encodeURIComponent(target.agentId)}&cwd=${encodeURIComponent(target.workdir)}`,
            agentName: this.deps.agentNameOf(target.agentId) ?? target.agentId
          }
        },
        {
          onSession: () => {},
          onDelta: (delta) => {
            text += delta
          },
          onDone: (final) => done({ ok: true, text: final || text }),
          onError: (message) => done({ ok: false, text, error: message })
        }
      )
      this.handles.set(run.projectId, handle)
    })

    if (!answer.ok) {
      this.finish(run, { state: 'error', error: answer.error ?? 'Модель не ответила' })
      return
    }
    try {
      const parsed = parseResearchOutput(answer.text)
      this.finish(run, { state: 'done', note: parsed.note, documents: this.apply(project.id, userId, parsed.documents) })
    } catch (err) {
      this.finish(run, { state: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Записывает статьи в раздел проекта. Чужой id молча превращается в новую статью. */
  private apply(projectId: string, userId: string, documents: ResearchDocument[]): KbResearchRun['documents'] {
    const own = new Set(this.deps.db.kbDocuments({ scope: 'project', projectId }).map((doc) => doc.id))
    const today = new Date(this.now()).toISOString().slice(0, 10)
    return documents.map((item) => {
      const id = item.id && own.has(item.id) ? item.id : null
      const saved = this.deps.db.saveKbDocument({
        id,
        scope: 'project',
        projectId,
        title: item.title,
        body: item.body,
        kind: item.kind,
        tags: item.tags,
        areas: item.areas,
        checkedOn: today,
        createdBy: userId
      })
      return { id: saved.id, title: saved.title, action: id ? ('updated' as const) : ('created' as const) }
    })
  }
}
