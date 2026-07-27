import type { ClaudeLogEntry, VoiceState } from '@shared/types'
import { activityStatus, pluralActions } from '../lib/view'
import { Dots } from './animations'
import { Markdown } from './Markdown'
import { MessageActivity, Section } from './MessageActivity'

export interface MessageTimelineProps {
  /** Текст ответа (уже очищен от спец-блоков ```tool/```image/```questions). */
  text: string
  /** Записи активности хода. Со смещением `at` — чередуются с абзацами текста. */
  activity: ClaudeLogEntry[]
  /** Раскрыть детали всех inline-действий (кнопка «Подробнее» уровня сообщения). */
  detailed: boolean
  /** Куда шли команды хода (для меток «где»). */
  execTarget?: string | null
  /** Живой (незавершённый) ход — строка статуса со спиннером сверху. */
  live?: boolean
  /** Голосовое состояние (для фразы живого статуса). */
  voice?: VoiceState
}

/**
 * Рендер ответа с действиями «в строку»: текст режется по смещениям `at`, и между
 * кусками встают секции действий в хронологическом порядке (абзац → действие(я) →
 * абзац). Работает и для завершённого сообщения, и для живого потока.
 *
 * Старые сообщения без `at` — fallback к прежнему виду: действия одной группой
 * (`MessageActivity`), затем текст.
 */
export function MessageTimeline({
  text,
  activity,
  detailed,
  execTarget = null,
  live = false,
  voice = 'idle'
}: MessageTimelineProps): JSX.Element | null {
  const canInterleave = activity.length > 0 && activity.every((e) => typeof e.at === 'number')

  if (!canInterleave) {
    // Нет данных о порядке (старое сообщение или ход без действий).
    if (activity.length === 0 && !live) return text ? <Markdown>{text}</Markdown> : null
    return (
      <>
        <MessageActivity
          activity={activity}
          detailed={detailed}
          execTarget={execTarget}
          live={live}
          voice={voice}
        />
        {text && <Markdown>{text}</Markdown>}
      </>
    )
  }

  // Стабильно сортируем по смещению; режем текст на куски и вставляем секции.
  const sorted = activity
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.at! - b.e.at! || a.i - b.i)
  const len = text.length
  const blocks: JSX.Element[] = []
  let prev = 0
  sorted.forEach(({ e }, k) => {
    const at = Math.max(prev, Math.min(e.at!, len))
    const seg = text.slice(prev, at)
    if (seg) blocks.push(<Markdown key={`t${k}`}>{seg}</Markdown>)
    blocks.push(<Section key={`a${k}`} entry={e} execTarget={execTarget} detailed={detailed} />)
    prev = at
  })
  const tail = text.slice(prev)
  if (tail) blocks.push(<Markdown key="t-tail">{tail}</Markdown>)

  const phrase = live ? activityStatus(activity, voice, execTarget) : null
  return (
    <div className="msgtl" data-testid="message-timeline">
      {live && (
        <div className="msgact-status">
          <Dots />
          {phrase && <span className="msgact-phrase">{phrase}</span>}
          <span className="msgact-count" data-testid="activity-count">
            {activity.length} {pluralActions(activity.length)}
          </span>
        </div>
      )}
      {blocks}
    </div>
  )
}
