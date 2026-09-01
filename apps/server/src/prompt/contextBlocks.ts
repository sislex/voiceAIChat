// Блоки системного промпта, которые сервер дописывает к каждому ходу, и их
// предпросмотр в инспекторе контекста.
//
// Живёт отдельно по той же причине, что `projects/promptContext.ts`: текст
// строят два места — ход модели (`turns.ts`) и снимок контекста
// (`routes/rest.ts`). Пока это были копии, они расходились: панель писала «год
// рождения 1990», а модель получала «Возраст пользователя: 36 лет». Инспектор
// обещает пользователю «вот что получит ИИ», поэтому расхождение здесь — не
// косметика, а неверные сведения.

import type { ChatInstruction, ContextPromptBlock, UserPersonalization } from '@voicechat/shared'
import { chatInstructionHintEntries, estimateCostUsd, instructionContextId } from '@voicechat/shared'
import type { ModelPrice } from '@voicechat/shared'
import type { ProjectSummary } from '@voicechat/shared'
import { projectPromptBlock } from '../projects/promptContext.js'

/** Грубая оценка токенов: 4 символа на токен. Точный счёт знает только движок. */
export function approxTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

/** Блок с посчитанным размером — форма, в которой его ждёт снимок контекста. */
export function promptBlock(itemIds: string[], title: string, text: string): ContextPromptBlock {
  return { itemIds, title, text, chars: text.length, approxTokens: approxTokens(text.length) }
}

const STYLE_LABEL: Record<string, string> = { brief: 'кратко', detailed: 'подробно', 'step-by-step': 'пошагово', normal: 'обычно' }
const TONE_LABEL: Record<string, string> = { friendly: 'дружелюбный', business: 'деловой', plain: 'простой, без сложных терминов', neutral: 'нейтральный' }

/**
 * Полных лет на дату `now` по дате рождения из персонализации. Считается по UTC —
 * так же, как раньше считал ход модели.
 */
export function ageFromBirth(p: UserPersonalization, now: Date): number | null {
  if (!p.birthYear) return null
  const month = p.birthMonth ?? 1
  const day = p.birthDay ?? 1
  const beforeBirthday = month > now.getUTCMonth() + 1 || (month === now.getUTCMonth() + 1 && day > now.getUTCDate())
  return Math.max(0, now.getUTCFullYear() - p.birthYear - (beforeBirthday ? 1 : 0))
}

/** Строки блока персонализации — ровно те, что уходят модели. */
export function personalizationLines(p: UserPersonalization, now: Date): string[] {
  const age = ageFromBirth(p, now)
  return [
    p.preferredName ? `Обращение к пользователю: ${p.preferredName}.` : '',
    p.responseLanguage ? `Обычный язык ответа: ${p.responseLanguage}; явная просьба в текущем сообщении имеет приоритет.` : '',
    p.responseStyle !== 'normal' ? `Стиль ответа: ${STYLE_LABEL[p.responseStyle] ?? p.responseStyle}.` : '',
    p.tone !== 'neutral' ? `Тон общения: ${TONE_LABEL[p.tone] ?? p.tone}.` : '',
    age === null ? '' : `Возраст пользователя: ${age} лет; адаптируй сложность только когда это уместно.`
  ].filter(Boolean)
}

/** Блок персонализации целиком; null — персонализация пуста, блока не будет. */
export function personalizationPromptBlock(p: UserPersonalization, now: Date): string | null {
  const lines = personalizationLines(p, now)
  if (!lines.length) return null
  return `## Персонализация пользователя\n${lines.join('\n')}\nЭти предпочтения уступают явной инструкции текущего сообщения и настройкам разговора/проекта.`
}

/** Человеческие подписи стиля/тона для карточки инспектора. */
export function personalizationLabels(p: UserPersonalization): { style: string; tone: string } {
  return { style: STYLE_LABEL[p.responseStyle] ?? p.responseStyle, tone: TONE_LABEL[p.tone] ?? p.tone }
}

/**
 * Блок проекта. Недоступный проект (удалён или потерян доступ) даёт тот же
 * текст, что и ход модели: id и прямое указание, что проекта больше нет.
 */
export function projectContextBlock(project: ProjectSummary | null, projectId: string | null): string | null {
  if (project) return projectPromptBlock(project)
  if (!projectId) return null
  return `## Контекст проекта «неизвестный проект»\nID проекта: ${projectId}\nПроект больше недоступен этому пользователю.`
}

export interface ContextBlocksInput {
  personalization: UserPersonalization
  /** Инструкции чата, уже отфильтрованные `effectiveChatInstructions`. */
  instructions: readonly ChatInstruction[]
  project: ProjectSummary | null
  projectId: string | null
  /** Готовый текст блока задачи (`taskContextBlock`); null — чат не про задачу. */
  taskContext?: string | null
  now: Date
}

/**
 * Блок «Контекст задачи» — иерархия, этап воркфлоу, машина и папка, описание и
 * критерии приёмки, макеты. Уходит в каждый ход чата задачи, поэтому строится
 * здесь, а не в `turns.ts`: инспектор обязан показывать тот же текст, а не
 * «проект такой-то». Аргументы — уже прочитанные из БД куски, чтобы функция
 * оставалась чистой и её мог позвать и ход, и снимок.
 */
export function taskContextBlock(input: {
  context: {
    task: { key: string; title: string }
    epic?: { key: string; title: string } | null
    story?: { key: string; title: string } | null
    columnName?: string | null
    columnSemantic?: string | null
    agentName?: string | null
    workdir?: string | null
    run?: { status: string; mode: string } | null
  }
  description?: string | null
  acceptanceCriteria?: string | null
  designLines?: string[]
}): string | null {
  const tc = input.context
  const lines = [
    `Задача: ${tc.task.key} · ${tc.task.title}`,
    tc.epic ? `Эпик: ${tc.epic.key} · ${tc.epic.title}` : '',
    tc.story ? `История: ${tc.story.key} · ${tc.story.title}` : '',
    tc.columnName ? `Этап разработки: ${tc.columnName}${tc.columnSemantic ? ` (${tc.columnSemantic})` : ''}` : '',
    tc.agentName ? `Машина разработки: ${tc.agentName}` : '',
    tc.workdir ? `Рабочая директория: ${tc.workdir}` : '',
    tc.run ? `Последний CI-ран: ${tc.run.status}, режим ${tc.run.mode === 'plan' ? 'план' : 'разработка'}` : ''
  ].filter(Boolean)
  if (input.description) lines.push(`Описание задачи: ${input.description}`)
  if (input.acceptanceCriteria) lines.push(`Критерии приёмки: ${input.acceptanceCriteria}`)
  if (input.designLines?.length) lines.push(...input.designLines)
  return lines.length ? `## Контекст задачи\n${lines.join('\n')}` : null
}

/**
 * Все блоки, которые сервер добавит к следующему ходу, в порядке сборки промпта
 * (`turns.ts`): проект, персонализация, инструкции чата. История разговора и
 * автоконтекст БЗ сюда не входят — первая не блок, второй зависит от текста
 * ещё не отправленного сообщения.
 */
export function buildContextBlocks(input: ContextBlocksInput): ContextPromptBlock[] {
  const blocks: ContextPromptBlock[] = []
  const project = projectContextBlock(input.project, input.projectId)
  if (project) blocks.push(promptBlock(['project-binding'], 'Контекст проекта', project))
  // Порядок тот же, что в `turns.ts`: проект, затем задача — иначе предпросмотр
  // показывал бы верный текст в неверном месте промпта.
  if (input.taskContext) blocks.push(promptBlock(['task-context'], 'Контекст задачи', input.taskContext))
  const personalization = personalizationPromptBlock(input.personalization, input.now)
  if (personalization) blocks.push(promptBlock(['personalization'], 'Персонализация пользователя', personalization))
  // Источники подсказки приходят от `chatInstructionHintEntries`: у склейки
  // консоль+проводник один текст на две инструкции, и оба пункта инспектора
  // должны находить свой блок.
  const byId = new Map(input.instructions.map((item) => [item.id, item]))
  for (const entry of chatInstructionHintEntries(input.instructions)) {
    const titles = entry.instructionIds.map((id) => byId.get(id)?.title).filter((title): title is string => Boolean(title))
    blocks.push(promptBlock(entry.instructionIds.map(instructionContextId), titles.join(' + ') || 'Инструкции чата', entry.text))
  }
  return blocks
}

/**
 * Каталоги, в которых CLI ищет AGENTS.md, — от корня к рабочей директории
 * («от общей к конкретной»). Только предки: файл ниже рабочей директории в
 * цепочку хода не входит.
 */
export function agentsChainDirs(workdir: string): string[] {
  const parts = workdir.replace(/\/+$/, '').split('/').filter(Boolean)
  const absolute = workdir.startsWith('/')
  const dirs: string[] = absolute ? ['/'] : []
  let current = absolute ? '' : '.'
  for (const part of parts) {
    current = `${current}/${part}`
    dirs.push(current)
  }
  return dirs
}

/**
 * Оценка стоимости постоянной части промпта в USD за один ход — только входные
 * токены. Сначала общий прайс `estimateCostUsd` (он знает и Claude, и ходовые
 * модели Codex), затем таблица `model_prices` — там тарифы, которые админ ведёт
 * руками, включая свои и редкие модели. `null` — цены нет ни там, ни там:
 * досчитывать выдуманной ценой нельзя, «—» честнее заниженной суммы.
 */
export function promptCostUsd(
  provider: 'claude' | 'codex',
  model: string,
  inputTokens: number,
  prices: ModelPrice[]
): number | null {
  if (!model || inputTokens <= 0) return null
  const known = estimateCostUsd(model, { inputTokens })
  if (known !== undefined) return known
  const row = prices.find((price) => price.model === model && (price.provider === provider || !price.provider))
  if (!row) return null
  return (inputTokens * row.inputPerMillion) / 1_000_000
}
