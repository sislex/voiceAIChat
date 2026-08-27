import type {
  ClaudeLogEntry,
  ClaudeLogKind,
  LlmProvider,
  MessageRole,
  TurnMeta,
  TurnUsage,
  VoiceState
} from '@shared/types'
import { estimateCostUsd } from '@shared/pricing'

export const ACCENT = '#3D64C8'

/**
 * Время сообщения для ленты: из createdAt (epoch ms) в часовом поясе зрителя.
 * Запечённая строка `time` — только фолбэк для записей без createdAt: у ответов
 * модели её формирует сервер в своём поясе (UTC в контейнере), и она «уезжает»
 * относительно реплик пользователя, отформатированных браузером.
 */
export function messageTime(m: { time: string; createdAt: number }): string {
  if (!m.createdAt) return m.time
  const d = new Date(m.createdAt)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Строка live-транскрипта во время записи. */
export interface LiveSegment {
  speakerId: number
  text: string
}

/** Номер спикера из роли `u1`/`u2`/… (или null для Claude). */
export function speakerNumber(role: MessageRole): number | null {
  if (role === 'ai') return null
  const n = Number(role.slice(1))
  return Number.isFinite(n) ? n : 1
}

/**
 * CSS-класс chip для роли (учитывает выключенную диаризацию). Для ответов ИИ
 * цвет зависит от движка: Claude — `spa`, Codex — `spx` (разные цвета, чтобы
 * сразу видеть, кто ответил).
 */
export function chipClass(role: MessageRole, diarization = true, engine?: LlmProvider): string {
  if (role === 'ai') return engine === 'codex' ? 'chip spx' : 'chip spa'
  if (!diarization) return 'chip sp1'
  const n = speakerNumber(role) ?? 1
  const idx = ((n - 1) % 4) + 1 // sp1..sp4, дальше по кругу
  return `chip sp${idx}`
}

/**
 * Подпись движка по значению, запечённому в сообщение. Отсутствие (старые
 * сообщения, созданные до появления поля) → «Claude» (исторический дефолт).
 */
export function engineLabel(engine?: LlmProvider): string {
  return engine === 'codex' ? 'Codex' : 'Claude'
}

/** Подпись спикера (учитывает выключенную диаризацию). aiLabel — имя движка. */
export function speakerName(role: MessageRole, diarization = true, aiLabel = 'Claude'): string {
  if (role === 'ai') return aiLabel
  if (!diarization) return 'Вы'
  return `Спикер ${speakerNumber(role) ?? 1}`
}

/** Текст бейджа статуса в шапке. aiLabel — имя движка (для «… думает»). */
export function statusBadge(state: VoiceState, aiLabel = 'Claude'): string {
  switch (state) {
    case 'idle':
      return 'Готов'
    case 'listening':
      return '● Запись'
    case 'transcribing':
      return 'Распознавание'
    case 'thinking':
      return `${aiLabel} думает`
    case 'speaking':
      return 'Озвучка'
  }
}

/**
 * Короткое объявление голосового цикла для скринридера (`aria-live` в VoiceBar).
 * Отдельно от видимой компактной строки сообщает читалке факт «микрофон
 * включён / распознаю / жду ответ». В простое молчим: возврат в
 * покой сам по себе не событие, а зачитывать подсказку заново незачем.
 */
export function voiceAnnouncement(state: VoiceState, aiLabel = 'Claude'): string {
  switch (state) {
    case 'idle':
      return ''
    case 'listening':
      return 'Идёт запись, говорите'
    case 'transcribing':
      return 'Запись остановлена, распознаю речь'
    case 'thinking':
      return `Запрос отправлен движку ${aiLabel}, ждём ответ`
    case 'speaking':
      return 'Воспроизведение ответа'
  }
}

/**
 * Подпись свёрнутого композера: что там осталось, если поле ввода убрано в
 * строку. Приоритет — у несохранённого: сперва черновик, потом вложения, и лишь
 * потом состояние голосового цикла (в простое ему сказать нечего).
 */
export function composerPeek(
  draft: string,
  attachmentCount: number,
  state: VoiceState,
  aiLabel = 'Claude'
): string {
  const text = draft.trim()
  if (text) return text
  if (attachmentCount > 0) return `Вложений: ${attachmentCount}`
  return voiceAnnouncement(state, aiLabel) || 'Показать поле ввода'
}

/** Компактная строка меты хода: «7.2с · 2 хода · $0.013 · 1.2k→0.4k ток.». */
export function formatTurnMeta(meta: TurnMeta): string {
  const parts: string[] = []
  if (typeof meta.durationMs === 'number') parts.push(`${(meta.durationMs / 1000).toFixed(1)}с`)
  if (typeof meta.numTurns === 'number') parts.push(`${meta.numTurns} ${pluralTurns(meta.numTurns)}`)
  if (typeof meta.costUsd === 'number') parts.push(`$${meta.costUsd.toFixed(meta.costUsd < 0.1 ? 4 : 2)}`)
  if (typeof meta.inputTokens === 'number' && typeof meta.outputTokens === 'number') {
    parts.push(`${kilo(meta.inputTokens)}→${kilo(meta.outputTokens)} ток.`)
  }
  return parts.join(' · ')
}

export function kilo(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** Часы:минуты:секунды по epoch ms в поясе зрителя (для времени начала/конца ответа). */
export function clockTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Полная дата-время для тултипа над временем. */
export function dateTimeTooltip(ms: number): string {
  return new Date(ms).toLocaleString('ru-RU')
}

/** Прошедшее время «мм:сс» для живого таймера ответа. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Ориентировочная стоимость ответа: реальную (costUsd от модели) показываем как
 * есть, иначе — расчётную по прайс-таблице (estimateCostUsd); null — оценить нельзя.
 */
export function messageCost(meta: TurnMeta): { text: string; estimated: boolean; title: string } | null {
  const real = typeof meta.costUsd === 'number' ? meta.costUsd : undefined
  const value = real ?? estimateCostUsd(meta.model, meta)
  if (typeof value !== 'number') return null
  const text = `$${value.toFixed(value < 0.1 ? 4 : 2)}`
  return {
    text: real !== undefined ? text : `≈ ${text}`,
    estimated: real === undefined,
    title: real !== undefined ? 'Стоимость из ответа модели' : 'Расчётная стоимость по тарифам (модель не сообщила цену)'
  }
}

/** Живой счётчик токенов стримящегося ответа: «↓ 1.2k · ↑ 356 · кэш 89.1k». */
export function formatLiveUsage(u: TurnUsage): string {
  const parts: string[] = []
  if (typeof u.inputTokens === 'number') parts.push(`↓ ${kilo(u.inputTokens)}`)
  if (typeof u.outputTokens === 'number') parts.push(`↑ ${kilo(u.outputTokens)}`)
  const cached = (u.cacheReadTokens ?? 0) + (u.cacheCreationTokens ?? 0)
  if (cached > 0) parts.push(`кэш ${kilo(cached)}`)
  return parts.join(' · ')
}

function pluralTurns(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'ход'
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'хода'
  return 'ходов'
}

// --- Активность хода (простой/подробный вид сообщения) --------------------

/** Короткий ярлык вида активности для бейджа (как в терминале). */
export const ACTIVITY_KIND_LABEL: Record<ClaudeLogKind, string> = {
  system: 'sys',
  thinking: 'think',
  tool_use: 'tool',
  tool_result: 'res',
  result: 'done',
  stt: '🎤',
  tts: '🔊',
  other: '···'
}

/** Имя инструмента из summary записи tool_use («Bash: ls» → «Bash»). */
function toolNameOf(entry: ClaudeLogEntry): string {
  const i = entry.summary.indexOf(':')
  return (i > 0 ? entry.summary.slice(0, i) : entry.summary).trim()
}

/** Где выполнялась команда: на выбранной машине или на сервере. */
function whereRan(execTarget?: string | null): string {
  return execTarget ? `на машине «${execTarget}»` : 'на сервере'
}

/** Множественное число для «N действий». */
/** Человеческая длительность: «<1с», «5с», «1м 20с». */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 950) return '<1с'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}с`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m}м ${r}с` : `${m}м`
}

export function pluralActions(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'действие'
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'действия'
  return 'действий'
}

/**
 * Живой статус хода «что сейчас происходит» по последней записи активности.
 * Явного таймера ожидания CLI не отдаёт — стадию «жду результат команды»
 * приближаем статусом по последней tool_use (команда отправлена, ждём ответа).
 */
export function activityStatus(
  entries: ClaudeLogEntry[],
  voice: VoiceState,
  execTarget?: string | null
): string {
  const last = entries[entries.length - 1]
  if (!last) return voice === 'transcribing' ? 'Распознаю речь…' : 'Отправляю запрос…'
  switch (last.kind) {
    case 'system':
      return 'Готовлю сессию…'
    case 'thinking':
      return 'Размышляю…'
    case 'tool_use': {
      const tool = toolNameOf(last)
      if (tool === 'Bash') return `Выполняю команду ${whereRan(execTarget)}…`
      if (['Read', 'Edit', 'Write', 'MultiEdit'].includes(tool))
        return `Работаю с файлами ${whereRan(execTarget)}…`
      return `Вызываю инструмент ${tool}…`
    }
    case 'tool_result':
      return 'Обрабатываю результат…'
    case 'result':
      return 'Готово'
    case 'stt':
      return 'Распознаю речь…'
    case 'tts':
      return 'Озвучиваю…'
    default:
      return 'Работаю…'
  }
}

/** Метка «где» для секции подробного вида (в модели / на машине / на клиенте). */
export function activityLocation(entry: ClaudeLogEntry, execTarget?: string | null): string {
  switch (entry.kind) {
    case 'tool_use':
    case 'tool_result':
      return whereRan(execTarget)
    case 'thinking':
    case 'system':
    case 'result':
      return 'в модели'
    case 'stt':
    case 'tts':
      return 'на клиенте'
    default:
      return ''
  }
}
