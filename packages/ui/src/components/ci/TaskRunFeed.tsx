import { useEffect, useMemo, useState } from 'react'
import type { CiRunDetail, CiRunReport, CiRunStep } from '@shared/ci'
import type { MergeRun } from '@shared/merge'
import { RunFeed, type RunFeedCache } from './RunFeed'
import { MergeRunFeed } from './MergeRunFeed'
import { ciStatusLabel } from './ciFormat'
import { EmptyState } from '@voicechat/ui-kit'
import { ErrorState } from '@voicechat/ui-kit'

type RunChoice =
  | { kind: 'development'; id: string; createdAt: number; status: string }
  | { kind: 'merge'; id: string; createdAt: number; status: string }

export interface TaskRunFeedProps {
  projectId: string
  taskId: string
  activeDevelopmentRunId?: string | null
  activeMergeRunId?: string | null
}

const FULL_WIDTH_FEED_STYLE = {
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
  boxSizing: 'border-box',
  overflowX: 'hidden'
} as const

function mergeLog(current: RunFeedCache['log'], incoming: RunFeedCache['log']): RunFeedCache['log'] {
  const bySeq = new Map(current.map((line) => [line.seq, line]))
  for (const line of incoming) bySeq.set(line.seq, line)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

function mergeSteps(current: CiRunStep[], incoming: CiRunStep[]): CiRunStep[] {
  const byId = new Map(current.map((step) => [step.id, step]))
  for (const step of incoming) byId.set(step.id, step)
  return [...byId.values()]
}

function mergeDetail(current: CiRunDetail | null, incoming: CiRunDetail): CiRunDetail {
  if (!current) return incoming
  return {
    ...incoming,
    steps: mergeSteps(current.steps, incoming.steps),
    fixAttempts: [...new Map([...incoming.fixAttempts, ...current.fixAttempts].map((item) => [item.id, item])).values()],
    interactions: [...new Map([...(incoming.interactions ?? []), ...(current.interactions ?? [])].map((item) => [item.id, item])).values()]
  }
}

export function TaskRunFeed(props: TaskRunFeedProps): JSX.Element {
  const [choices, setChoices] = useState<RunChoice[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [cache, setCache] = useState<Record<string, RunFeedCache>>({})
  const [loadingChoices, setLoadingChoices] = useState(true)
  const [choicesError, setChoicesError] = useState<string | null>(null)

  const loadChoices = (): void => {
    setLoadingChoices(true)
    setChoicesError(null)
    Promise.all([
      window.ci?.getTaskReport(props.projectId, props.taskId),
      window.ci?.listMergeRuns(props.projectId, props.taskId)
    ]).then(([report, mergeRuns]) => {
      const development: RunChoice[] = (report?.runs ?? []).map((run: CiRunReport) => ({
        kind: 'development', id: run.runId, createdAt: run.createdAt, status: run.status
      }))
      const merge: RunChoice[] = (mergeRuns ?? []).map((run: MergeRun) => ({
        kind: 'merge', id: run.id, createdAt: run.createdAt, status: run.status
      }))
      const all = [...development, ...merge].sort((a, b) => b.createdAt - a.createdAt)
      setChoices(all)
      setSelected((current) => {
        if (current && all.some((item) => item.id === current)) return current
        return props.activeDevelopmentRunId ?? props.activeMergeRunId ?? all[0]?.id ?? null
      })
      setLoadingChoices(false)
    }).catch((error) => {
      setChoicesError(error instanceof Error ? error.message : String(error))
      setLoadingChoices(false)
    })
  }

  useEffect(loadChoices, [props.projectId, props.taskId, props.activeDevelopmentRunId, props.activeMergeRunId])

  const selectedRun = useMemo(() => choices.find((run) => run.id === selected) ?? null, [choices, selected])
  const patch = (runId: string, update: (current: RunFeedCache) => RunFeedCache): void => {
    setCache((all) => {
      const current = all[runId] ?? { detail: null, log: [], conclusion: null }
      return { ...all, [runId]: update(current) }
    })
  }

  const loadRun = (runId: string): void => {
    patch(runId, (current) => ({ ...current, loading: true, error: null }))
    Promise.all([window.ci?.getRun(runId), window.ci?.getRunLog(runId)]).then(([detail, log]) => {
      if (!detail) throw new Error('CI bridge недоступен')
      patch(runId, (current) => ({ ...current, detail: mergeDetail(current.detail, detail), log: mergeLog(current.log, log ?? []), loading: false, error: null }))
    }).catch((error) => patch(runId, (current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) })))
  }

  useEffect(() => {
    const bridge = window.ci
    if (!bridge || !selectedRun || selectedRun.kind !== 'development') return
    const runId = selectedRun.id
    bridge.subscribe(runId)
    const offSnapshot = bridge.onSnapshot((message) => {
      if (message.runId === runId) patch(runId, (current) => ({ ...current, detail: mergeDetail(current.detail, message.detail), log: mergeLog(current.log, message.log) }))
    })
    const offRun = bridge.onRun((message) => {
      if (message.runId !== runId) return
      patch(runId, (current) => ({ ...current, detail: current.detail ? { ...current.detail, run: message.run } : { run: message.run, steps: [], fixAttempts: [], interactions: [] } }))
    })
    const offStep = bridge.onStep((message) => {
      if (message.runId !== runId) return
      patch(runId, (current) => current.detail ? { ...current, detail: { ...current.detail, steps: mergeSteps(current.detail.steps, [message.step]) } } : current)
    })
    const offLog = bridge.onLog((message) => {
      if (message.runId === runId) patch(runId, (current) => ({ ...current, log: mergeLog(current.log, [message.line]) }))
    })
    const offDone = bridge.onDone((message) => {
      if (message.runId !== runId) return
      patch(runId, (current) => ({ ...current, conclusion: message.conclusion ?? current.conclusion, detail: current.detail ? { ...current.detail, run: message.run } : { run: message.run, steps: [], fixAttempts: [], interactions: [] } }))
      loadChoices()
    })
    return () => {
      bridge.unsubscribe(runId)
      offSnapshot(); offRun(); offStep(); offLog(); offDone()
    }
  }, [selectedRun?.id, selectedRun?.kind])

  if (loadingChoices && choices.length === 0) return <div className="task-run-feed" style={FULL_WIDTH_FEED_STYLE}><p className="task-tab-empty" aria-live="polite">Загрузка технической ленты…</p></div>
  if (choicesError && choices.length === 0) return <div className="task-run-feed" style={FULL_WIDTH_FEED_STYLE}><ErrorState message="Не удалось загрузить список запусков" detail={choicesError} onRetry={loadChoices} /></div>
  if (choices.length === 0) return <div className="task-run-feed" style={FULL_WIDTH_FEED_STYLE}><EmptyState compact icon="⏱" title="Запусков ещё нет" description="Техническая лента появится после development- или merge-запуска." /></div>

  return <div className="task-run-feed" style={FULL_WIDTH_FEED_STYLE}>
    <div className="task-run-feed__toolbar">
      <label>Запуск
        <select aria-label="Выбранный запуск" className="sel" value={selected ?? ''} onChange={(event) => setSelected(event.target.value)}>
          <optgroup label="Development-раны">
            {choices.filter((run) => run.kind === 'development').map((run) => <option key={run.id} value={run.id}>Development · {ciStatusLabel(run.status as never)} · {new Date(run.createdAt).toLocaleString('ru')}</option>)}
          </optgroup>
          <optgroup label="Merge-раны">
            {choices.filter((run) => run.kind === 'merge').map((run) => <option key={run.id} value={run.id}>Merge · {run.status} · {new Date(run.createdAt).toLocaleString('ru')}</option>)}
          </optgroup>
        </select>
      </label>
      {selectedRun && <span className={`task-run-feed__kind task-run-feed__kind--${selectedRun.kind}`}>{selectedRun.kind === 'development' ? 'Development' : 'Merge'}</span>}
    </div>
    {loadingChoices && <span className="task-tab-empty">Обновляем список запусков…</span>}
    {selectedRun?.kind === 'merge' && <MergeRunFeed runId={selectedRun.id} onRunChanged={loadChoices} />}
    {selectedRun?.kind === 'development' && <RunFeed
      runId={selectedRun.id}
      cache={cache[selectedRun.id]}
      onSubscribe={() => undefined}
      onUnsubscribe={() => undefined}
      onLoad={loadRun}
      onRetry={(runId) => { void window.ci?.retryRun(runId).then((run) => { if (run) setSelected(run.id) }) }}
      onRetryFromStep={(runId, selection) => { void window.ci?.retryRunFromStep(runId, selection).then(() => loadRun(runId)) }}
      onDiscardAndRetry={(runId) => { void window.ci?.discardChangesAndRetry(runId).then((run) => { if (run) setSelected(run.id) }) }}
      onCancel={(runId) => { void window.ci?.cancelRun(runId) }}
      onAnswerInteraction={(runId, interactionId, answer) => { void window.ci?.answerInteraction(runId, interactionId, answer).then(() => loadRun(runId)) }}
    />}
  </div>
}
