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

import type { KbDocumentKind, KbResearchRun, ProjectDetail } from '@voicechat/shared'
import type { LlmClient, LlmHandle } from '../claude/types.js'
import type { VoiceChatDb } from '../db/database.js'

/** Сколько статей принимаем за один прогон и какой длины (защита от «простыни»). */
const MAX_DOCUMENTS = 12
const MAX_BODY_CHARS = 24_000
/** Исследование репозитория — операция минут; дальше глушим CLI. */
const TIMEOUT_MS = 15 * 60 * 1000

const KINDS = new Set<KbDocumentKind>(['feature','subsystem','protocol','decision','convention','runbook','package'])

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

/** Статья, которую вернула модель (после разбора и обрезки). */
export interface ResearchDocument {
  id?: string
  title: string
  kind?: KbDocumentKind
  tags?: string[]
  areas?: string[]
  body: string
}

/**
 * Разбор ответа модели: терпим к ```json-обёртке и тексту вокруг (как
 * parseVariants в помощнике промптов). Мусорные записи молча отбрасываем —
 * половина хорошего результата лучше, чем ошибка на всём прогоне.
 */
export function parseResearchOutput(raw: string): { note: string; documents: ResearchDocument[] } {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Модель вернула неразборчивый ответ')
    parsed = JSON.parse(match[0])
  }
  const root = parsed as { note?: unknown; documents?: unknown }
  const list = Array.isArray(root.documents) ? root.documents : []
  const documents: ResearchDocument[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    const body = typeof raw.body === 'string' ? raw.body.trim() : ''
    if (!title || !body) continue
    const kind = typeof raw.kind === 'string' && KINDS.has(raw.kind as KbDocumentKind) ? (raw.kind as KbDocumentKind) : 'subsystem'
    documents.push({
      ...(typeof raw.id === 'string' && raw.id.trim() ? { id: raw.id.trim() } : {}),
      title,
      kind,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
      areas: Array.isArray(raw.areas) ? raw.areas.filter((t): t is string => typeof t === 'string') : [],
      body: body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n\n[…текст обрезан сервером]` : body
    })
    if (documents.length >= MAX_DOCUMENTS) break
  }
  return { note: typeof root.note === 'string' ? root.note.trim() : '', documents }
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
  start(userId: string, project: ProjectDetail): KbResearchRun {
    const current = this.runs.get(project.id)
    if (current?.state === 'running') return current
    const target = researchTarget(project)
    if (!target) throw new Error('У проекта нет машины с рабочей папкой — привяжите машину в настройках проекта')
    const run: KbResearchRun = {
      projectId: project.id,
      state: 'running',
      startedBy: userId,
      startedAt: this.now(),
      finishedAt: null,
      documents: [],
      note: '',
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
    const existing = db.kbDocuments({ scope: 'project', projectId: project.id }).map((doc) => ({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt }))
    const config = db.getCiLlmConfig('project', project.id)
    const client = config?.provider === 'codex' ? this.deps.codex : this.deps.claude
    const model = config?.provider === 'codex' ? config.model : config?.model || 'sonnet'
    const prompt = researchPrompt(project, target.workdir, existing)
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
