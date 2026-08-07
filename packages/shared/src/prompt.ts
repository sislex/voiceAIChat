// Сборка промпта для Claude (Шаг 8). Чистые функции.

import { parseImages } from './images'
import type { SttSegmentWire } from './protocol'
import type { MessageRole, TaskLaunchProposal, TaskLaunchRequest } from './types'
import { normalizeClaudeModel } from './types'

/** Добавляет к телу промпта просьбу прочитать вложенные файлы (пути абсолютные). */
function withAttachments(body: string, attachmentPaths: string[]): string {
  const files = attachmentPaths.filter((p) => p.trim().length > 0)
  if (files.length === 0) return body
  const list = files.map((p) => `- ${p}`).join('\n')
  const note = `К сообщению приложены файлы — прочитай их и учти при ответе:\n${list}`
  return body ? `${body}\n\n${note}` : note
}

/**
 * Правило выбора способа работы перед изменением проекта. Это не относится к
 * ответам, исследованию и отчётам: спрашивать нужно только до изменения файлов,
 * исправления бага или добавления фичи.
 */
export const CHANGE_AUTHORIZATION_HINT = [
  'Если ты собираешься исправлять, менять или добавлять что-либо в проект, сначала спроси разрешение пользователя и не начинай работу до его ответа.',
  'В этом случае добавь в самом конце ответа один или несколько отдельных блоков ```task-launch с JSON вида {"title":"…","description":"…","acceptanceCriteria":"…"}.',
  'Каждый блок означает независимое предложение задачи; UI позволит отдельно создать её в TODO или InProgress либо отклонить предложение и работать в текущем чате.',
  'Заполняй поля блока по согласованному с пользователем плану. Не добавляй блок для вопросов, объяснений, исследований и отчётов.',
  'Если пользователь выбрал работу в текущем чате, после выполнения отдельно спроси, можно ли коммитить и пушить изменения.'
].join('\n')

/** Добавляет правило выбора способа работы к непустому промпту. */
export function appendChangeAuthorizationHint(prompt: string): string {
  if (!prompt.trim()) return prompt
  return `${prompt}\n\n${CHANGE_AUTHORIZATION_HINT}`
}

/** Отделяет машинный запрос запуска задачи от текста, который увидит пользователь. */
export function parseTaskLaunchRequest(text: string): { text: string; request?: TaskLaunchRequest; requests?: TaskLaunchProposal[] } {
  const suffix = /(?:\n?```task-launch\s*\n[\s\S]*?\n```\s*)+$/u.exec(text)
  if (!suffix) return { text }
  const requests: TaskLaunchProposal[] = []
  const fence = /```task-launch\s*\n([\s\S]*?)\n```/gu
  for (const match of suffix[0].matchAll(fence)) {
    try {
      const values: unknown[] = Array.isArray(JSON.parse(match[1])) ? JSON.parse(match[1]) as unknown[] : [JSON.parse(match[1])]
      for (const value of values) {
        if (!value || typeof value !== 'object') return { text }
        const source = value as Record<string, unknown>
        const title = typeof source.title === 'string' ? source.title.trim() : ''
        const description = typeof source.description === 'string' ? source.description.trim() : ''
        const acceptanceCriteria = typeof source.acceptanceCriteria === 'string' ? source.acceptanceCriteria.trim() : ''
        if (!title || !description || !acceptanceCriteria) return { text }
        requests.push({ id: `task-launch-${requests.length + 1}`, title, description, acceptanceCriteria })
      }
    } catch {
      return { text }
    }
  }
  if (!requests.length) return { text }
  if (requests.length === 1) {
    const { id: _id, ...request } = requests[0]
    return { text: text.slice(0, suffix.index).trimEnd(), request }
  }
  return { text: text.slice(0, suffix.index).trimEnd(), requests }
}

/**
 * Промпт для одного хода (используется при продолжении сессии `--resume`).
 * При нескольких говорящих проставляет метки `[Спикер N]:`; при одном — просто
 * склеенный текст. Пустые сегменты отбрасываются.
 */
export function buildPrompt(segments: SttSegmentWire[], attachmentPaths: string[] = []): string {
  const nonEmpty = segments.filter((s) => s.text.trim().length > 0)

  const distinctSpeakers = new Set(nonEmpty.map((s) => s.speakerId))
  let body: string
  if (nonEmpty.length === 0) {
    body = ''
  } else if (distinctSpeakers.size <= 1) {
    body = nonEmpty.map((s) => s.text.trim()).join(' ')
  } else {
    body = nonEmpty.map((s) => `[Спикер ${s.speakerId}]: ${s.text.trim()}`).join('\n')
  }

  return withAttachments(body, attachmentPaths)
}

/** Реплика для сборки промпта из истории (роль + текст). */
export interface PromptMessage {
  role: MessageRole
  text: string
}

/**
 * Промпт из полной истории разговора — для «холодного» старта сессии (когда
 * `--resume` недоступен: новый разговор либо сессия сброшена после удаления/правки
 * сообщения). Контекст модели = текущая история в БД, поэтому удалённые реплики
 * в него не попадают. Один ход (без предыдущей истории) отдаётся как обычный
 * текст — поведение идентично buildPrompt для нового разговора.
 */
export function buildConversationPrompt(
  messages: PromptMessage[],
  attachmentPaths: string[] = []
): string {
  // Служебные image-блоки AI-ответа нужны UI, но не модели при пересборке
  // истории: она уже получила описание картинки в предыдущем ответе.
  const nonEmpty = messages
    .map((m) => (m.role === 'ai' ? { ...m, text: parseImages(m.text).body } : m))
    .filter((m) => m.text.trim().length > 0)
  let body: string
  if (nonEmpty.length <= 1) {
    body = nonEmpty[0]?.text.trim() ?? ''
  } else {
    body = nonEmpty
      .map((m) => `${m.role === 'ai' ? 'Ассистент' : 'Пользователь'}: ${m.text.trim()}`)
      .join('\n\n')
  }
  return withAttachments(body, attachmentPaths)
}

/** Маппинг модели из настроек в алиас модели Claude CLI. */
export function claudeModelAlias(model: string): string {
  return normalizeClaudeModel(model)
}
