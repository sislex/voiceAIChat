import { useEffect, useRef, useState } from 'react'
import { Button, ErrorState, Skeleton, useToast } from '@voicechat/ui-kit'
import { acceptMergeSnapshot, type MergeMachinesResponse, type MergeRun } from '@shared/merge'
import './QueuedMergeMachine.css'

/** One action and one synchronous submission lock, shared by both merge surfaces. */
export function QueuedMergeMachine({ run, onRunChanged }: {
  run: MergeRun; onRunChanged: (run: MergeRun) => void
}): JSX.Element | null {
  const [machines, setMachines] = useState<MergeMachinesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(run.agentId)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const latestRun = useRef(run)
  latestRun.current = run
  const lock = useRef(false)
  const alive = useRef(true)
  const selectRef = useRef<HTMLSelectElement>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const toast = useToast()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { setSelected(run.agentId) }, [run.agentId, run.assignmentVersion])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void window.ci!.getMergeMachines(run.projectId, run.taskId).then(result => {
      if (!cancelled) { setMachines(result); setError('') }
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [run.projectId, run.taskId, reload])
  useEffect(() => window.board?.onReconnect?.(() => setReload(value => value + 1)), [])
  const ready = machines?.machines.find(machine => machine.agentId === selected)?.readiness.selectable
  const alternative = machines?.machines.some(machine => machine.agentId !== run.agentId && machine.readiness.selectable)
  const submit = async () => {
    if (lock.current || loading || !ready || selected === run.agentId || run.status !== 'queued') return
    lock.current = true; setPending(true); setError(''); setNotice('Меняем машину…')
    try {
      const result = await window.ci!.changeMergeMachine(run.id, { agentId: selected, expectedAssignmentVersion: run.assignmentVersion ?? 0 })
      if (!alive.current) return
      if ('run' in result && !acceptMergeSnapshot(latestRun.current, result.run)) {
        setNotice('Состояние рана уже обновлено.'); return
      }
      if ('run' in result) onRunChanged(result.run)
      if (result.ok) {
        setNotice('Машина изменена. Ран в очереди.')
      } else {
        setNotice(''); setError(result.error); toast.error(result.error)
      }
    } catch (cause) {
      if (alive.current) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setError(message); setNotice(''); toast.error(message)
      }
    } finally {
      lock.current = false
      if (alive.current) {
        setPending(false)
        requestAnimationFrame(() => { (selectRef.current ?? statusRef.current)?.focus() })
      }
    }
  }
  if (run.status !== 'queued' && !notice && !error) return null
  return <section className="queued-merge-machine" aria-label="Смена машины merge-рана" aria-busy={loading || pending}>
    <p ref={statusRef} tabIndex={-1} role="status">{run.status !== 'queued' ? 'Ран больше не находится в очереди' : notice || 'Ран в очереди'}</p>
    {error && <ErrorState compact message={error} onRetry={() => setReload(value => value + 1)} />}
    {run.status === 'queued' && <>
      {loading && !machines && <Skeleton variant="block" height={48} />}
      <label>Машина рана в очереди
        <select ref={selectRef} aria-label="Новая машина merge-рана" value={selected}
          disabled={loading || pending} onChange={event => setSelected(event.target.value)}>
          {!machines?.machines.some(machine => machine.agentId === run.agentId) && <option value={run.agentId}>{run.machineName ?? run.agentId}</option>}
          {machines?.machines.map(machine => <option key={machine.agentId} value={machine.agentId} disabled={!machine.readiness.selectable}>
            {machine.name} — {machine.readiness.message}
          </option>)}
        </select>
      </label>
      {!loading && !alternative && <p>Нет другой готовой машины проекта.</p>}
      <Button loading={pending} disabled={loading || !ready || selected === run.agentId} onClick={() => void submit()}>Сменить машину</Button>
    </>}
  </section>
}
