import { useState } from 'react'
import type { ClaudeLogEntry, VoiceState } from '@shared/types'
import { ACTIVITY_KIND_LABEL, activityLocation, activityStatus, pluralActions } from '../lib/view'
import { Dots } from './animations'

export interface MessageActivityProps {
  /** Записи активности хода (для завершённого сообщения — из meta.activity). */
  activity: ClaudeLogEntry[]
  /** Показать секции (подробный вид). false — только строка статуса. */
  detailed: boolean
  /** Куда шли команды хода (для меток «где»): машина или сервер. */
  execTarget?: string | null
  /** Живой (незавершённый) ход — статус со спиннером и фразой «что происходит». */
  live?: boolean
  /** Текущее голосовое состояние (для фразы статуса живого хода). */
  voice?: VoiceState
}

/** Одна секция подробного вида: клик раскрывает detail + сырой stream-json. */
function Section({
  entry,
  execTarget
}: {
  entry: ClaudeLogEntry
  execTarget?: string | null
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const where = activityLocation(entry, execTarget)
  return (
    <div className={`actsec clk-${entry.kind}`} data-testid="activity-section">
      <button
        className="actsec-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="clbadge">{ACTIVITY_KIND_LABEL[entry.kind]}</span>
        {where && <span className="actsec-where">{where}</span>}
        <span className="clsum">{entry.summary}</span>
      </button>
      {expanded && (
        <div className="clraw" data-testid="activity-raw">
          {entry.detail && <div className="cldetail">{entry.detail}</div>}
          <pre className="clpre">{entry.raw}</pre>
        </div>
      )}
    </div>
  )
}

/**
 * Активность ответа модели: строка статуса (что происходит + счётчик действий) и,
 * в подробном виде, последовательные секции «как в консоли» с меткой места.
 * Для живого хода статус со спиннером; для завершённого — счётчик действий.
 */
export function MessageActivity({
  activity,
  detailed,
  execTarget = null,
  live = false,
  voice = 'idle'
}: MessageActivityProps): JSX.Element | null {
  const count = activity.length
  // Завершённый ход без активности (обычный ответ без инструментов) — ничего не рисуем.
  if (!live && count === 0) return null

  const phrase = live ? activityStatus(activity, voice, execTarget) : null

  return (
    <div className="msgact" data-testid="message-activity">
      <div className="msgact-status">
        {live && <Dots />}
        {phrase && <span className="msgact-phrase">{phrase}</span>}
        {count > 0 && (
          <span className="msgact-count" data-testid="activity-count">
            {count} {pluralActions(count)}
          </span>
        )}
      </div>
      {detailed && count > 0 && (
        <div className="msgact-sections" data-testid="activity-sections">
          {activity.map((entry, i) => (
            <Section key={i} entry={entry} execTarget={execTarget} />
          ))}
        </div>
      )}
    </div>
  )
}
