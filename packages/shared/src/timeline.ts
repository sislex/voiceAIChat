export type TaskTimelineStatus = 'queued' | 'running' | 'awaiting_input' | 'succeeded' | 'failed' | 'cancelled' | 'skipped'

export interface TaskTimelineInterval {
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
}
export interface TaskTimelineReason { code: string | null; message: string | null }
export interface TaskTimelineRunLink { id: string; kind: string }
export interface TaskTimelineAttempt {
  id: string; number: number; status: TaskTimelineStatus
  queuedAt: string | null; startedAt: string | null; finishedAt: string | null
  queueIntervals: TaskTimelineInterval[]; activeIntervals: TaskTimelineInterval[]; awaitingInputIntervals: TaskTimelineInterval[]
  queueDuration: number | null; activeDuration: number | null; awaitingInputDuration: number | null; calendarDuration: number | null
  executor: string | null; machine: string | null; model: string | null
  reason: TaskTimelineReason | null; runs: TaskTimelineRunLink[]; dataComplete: boolean
}
export interface TaskTimelineStage {
  id: string; type: string; title: string; status: TaskTimelineStatus
  queuedAt: string | null; startedAt: string | null; finishedAt: string | null
  queueDuration: number | null; activeDuration: number | null; awaitingInputDuration: number | null; calendarDuration: number | null
  attemptCount: number; successfulDuration: number; unsuccessfulDuration: number
  executor: string | null; machine: string | null; model: string | null
  reason: TaskTimelineReason | null; runs: TaskTimelineRunLink[]; attempts: TaskTimelineAttempt[]
  workflowPosition: number | null; dataComplete: boolean
}
export interface TaskTimelineSummary {
  createdAt: string; firstStartedAt: string | null; finishedAt: string | null; calendarDuration: number | null
  activeDuration: number; queueDuration: number; awaitingInputDuration: number; lastChangedAt: string
}
export interface TaskTimeline {
  version: 1; taskId: string; generatedAt: string; summary: TaskTimelineSummary; stages: TaskTimelineStage[]
}
export function timelineIso(value: number | null | undefined): string | null {
  return value == null ? null : new Date(value).toISOString()
}
export function timelineDuration(start: number | null | undefined, end: number | null | undefined): number | null {
  return start == null || end == null ? null : Math.max(0, end - start)
}
export function mergeTimelineIntervals(intervals: Array<{ start: number | null; end: number | null }>): Array<{ start: number; end: number }> {
  const sorted = intervals.filter((item): item is { start: number; end: number } => item.start != null && item.end != null)
    .map((item) => ({ start: item.start, end: Math.max(item.start, item.end) })).sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Array<{ start: number; end: number }> = []
  for (const item of sorted) {
    const previous = merged[merged.length - 1]
    if (!previous || item.start > previous.end) merged.push({ ...item })
    else previous.end = Math.max(previous.end, item.end)
  }
  return merged
}
export function mergedTimelineDuration(intervals: Array<{ start: number | null; end: number | null }>): number {
  return mergeTimelineIntervals(intervals).reduce((total, item) => total + item.end - item.start, 0)
}
export function subtractTimelineIntervals(source: Array<{ start: number; end: number | null }>, excluded: Array<{ start: number; end: number | null }>): Array<{ start: number; end: number | null }> {
  const closed = mergeTimelineIntervals(excluded.map((item) => ({ start: item.start, end: item.end })))
  const result: Array<{ start: number; end: number | null }> = []
  for (const interval of source) {
    let cursor = interval.start
    for (const cut of closed) {
      if (cut.end <= cursor || (interval.end != null && cut.start >= interval.end)) continue
      if (cut.start > cursor) result.push({ start: cursor, end: cut.start })
      cursor = Math.max(cursor, cut.end)
    }
    if (interval.end == null || cursor < interval.end) result.push({ start: cursor, end: interval.end })
  }
  return result
}
