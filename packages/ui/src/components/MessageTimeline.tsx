import { useEffect, useState } from 'react'
import type { ClaudeLogEntry, VoiceState } from '@shared/types'
import { ACTIVITY_KIND_LABEL, activityStatus, formatDuration, pluralActions } from '../lib/view'
import { Dots } from './animations'
import { Markdown } from './Markdown'
import { MessageActivity, Section } from './MessageActivity'

/** Режим отображения хода:
 *  - minimal  — только текст ответа абзацами (действия скрыты);
 *  - brief    — текст + сводка на секцию действий (какое, сколько шло, последнее);
 *  - detailed — текст + каждое действие строкой (детали по клику). */
export type TimelineMode = 'minimal' | 'brief' | 'detailed'

export const TIMELINE_MODES: TimelineMode[] = ['minimal', 'brief', 'detailed']
export const TIMELINE_MODE_LABEL: Record<TimelineMode, string> = {
  minimal: 'Минимально',
  brief: 'Кратко',
  detailed: 'Подробно'
}
const TIMELINE_MODE_ICON: Record<TimelineMode, string> = {
  minimal: '○',
  brief: '≡',
  detailed: '≣'
}
/** Следующий режим по кругу minimal → brief → detailed → minimal. */
export function nextTimelineMode(m: TimelineMode): TimelineMode {
  return TIMELINE_MODES[(TIMELINE_MODES.indexOf(m) + 1) % TIMELINE_MODES.length]
}
export function timelineModeButtonLabel(m: TimelineMode): string {
  return `${TIMELINE_MODE_ICON[m]} ${TIMELINE_MODE_LABEL[m]}`
}

export interface MessageTimelineProps {
  /** Текст ответа (уже очищен от спец-блоков ```tool/```image/```questions). */
  text: string
  /** Записи активности хода. Со смещением `at` — чередуются с абзацами текста. */
  activity: ClaudeLogEntry[]
  /** Режим отображения. */
  mode: TimelineMode
  /** Куда шли команды хода (для меток «где»). */
  execTarget?: string | null
  /** Живой (незавершённый) ход — статус со спиннером и живой таймер в brief. */
  live?: boolean
  /** Голосовое состояние (для фразы живого статуса). */
  voice?: VoiceState
  /** Момент завершения хода (epoch мс) — граница для длительностей завершённого. */
  endMs?: number
}

interface ActionsBlock {
  kind: 'actions'
  entries: ClaudeLogEntry[]
}
type Block = { kind: 'text'; text: string } | ActionsBlock

/** Сводка одной секции действий: что идёт, сколько шли действия, сколько последнее. */
function BriefLine({
  entries,
  boundaryMs,
  live
}: {
  entries: ClaudeLogEntry[]
  boundaryMs: number
  live: boolean
}): JSX.Element {
  const last = entries[entries.length - 1]
  const n = entries.length
  const withTs = entries.filter((e) => typeof e.ts === 'number')
  let timing = ''
  if (withTs.length) {
    const firstTs = withTs[0].ts!
    const lastTs = withTs[withTs.length - 1].ts!
    const sectionMs = Math.max(0, boundaryMs - firstTs)
    const lastMs = Math.max(0, boundaryMs - lastTs)
    timing = ` · ${formatDuration(sectionMs)}`
    if (lastMs >= 950) timing += ` · последнее ${formatDuration(lastMs)}`
  }
  return (
    <div className="actbrief" data-testid="activity-brief">
      {live && <Dots />}
      <span className="clbadge">{ACTIVITY_KIND_LABEL[last.kind]}</span>
      <span className="clsum">{last.summary}</span>
      <span className="actbrief-meta">
        {n} {pluralActions(n)}
        {timing}
      </span>
    </div>
  )
}

/**
 * Ответ модели в одном из трёх видов. Действия чередуются с абзацами по смещению
 * `at`; brief сворачивает секцию действий в одну строку с таймингами (в живом виде
 * время последнего действия тикает раз в секунду). Старые сообщения без `at` —
 * fallback к прежнему виду (`MessageActivity`).
 */
export function MessageTimeline({
  text,
  activity,
  mode,
  execTarget = null,
  live = false,
  voice = 'idle',
  endMs
}: MessageTimelineProps): JSX.Element | null {
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!(live && mode === 'brief')) return
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [live, mode])

  // Минимально — только текст. В живом виде без текста показываем строку статуса.
  if (mode === 'minimal') {
    if (text) return <Markdown>{text}</Markdown>
    if (live) {
      return (
        <div className="msgact-status">
          <Dots />
          <span className="msgact-phrase">{activityStatus(activity, voice, execTarget)}</span>
        </div>
      )
    }
    return null
  }

  const canInterleave = activity.length > 0 && activity.every((e) => typeof e.at === 'number')

  // Старое сообщение (нет смещений) или ход без действий — прежний вид.
  if (!canInterleave) {
    if (activity.length === 0 && !live) return text ? <Markdown>{text}</Markdown> : null
    return (
      <>
        <MessageActivity
          activity={activity}
          detailed={mode === 'detailed'}
          execTarget={execTarget}
          live={live}
          voice={voice}
        />
        {text && <Markdown>{text}</Markdown>}
      </>
    )
  }

  // Режем текст по смещениям и группируем подряд идущие действия (между абзацами).
  const sorted = activity
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.at! - b.e.at! || a.i - b.i)
  const len = text.length
  const blocks: Block[] = []
  let prev = 0
  let cur: ActionsBlock | null = null
  for (const { e } of sorted) {
    const at = Math.max(prev, Math.min(e.at!, len))
    const seg = text.slice(prev, at)
    if (seg) {
      cur = null
      blocks.push({ kind: 'text', text: seg })
    }
    if (!cur) {
      cur = { kind: 'actions', entries: [] }
      blocks.push(cur)
    }
    cur.entries.push(e)
    prev = at
  }
  const tail = text.slice(prev)
  if (tail) blocks.push({ kind: 'text', text: tail })

  // Границы секций для brief: старт следующей секции, иначе конец хода / «сейчас».
  const actionGroups = blocks.filter((b): b is ActionsBlock => b.kind === 'actions')
  const boundaryOf = new Map<ActionsBlock, number>()
  actionGroups.forEach((g, gi) => {
    const nextTs = actionGroups[gi + 1]?.entries.find((e) => typeof e.ts === 'number')?.ts
    const fallback = live ? nowTick : endMs ?? nowTick
    boundaryOf.set(g, nextTs ?? fallback)
  })
  const lastGroup = actionGroups[actionGroups.length - 1]

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
      {blocks.map((b, k) =>
        b.kind === 'text' ? (
          <Markdown key={`t${k}`}>{b.text}</Markdown>
        ) : mode === 'detailed' ? (
          <div className="msgtl-actions" key={`a${k}`}>
            {b.entries.map((e, j) => (
              <Section key={j} entry={e} execTarget={execTarget} />
            ))}
          </div>
        ) : (
          <BriefLine
            key={`a${k}`}
            entries={b.entries}
            boundaryMs={boundaryOf.get(b) ?? nowTick}
            live={live && b === lastGroup}
          />
        )
      )}
    </div>
  )
}
