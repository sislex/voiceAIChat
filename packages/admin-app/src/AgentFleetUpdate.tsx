// Обновление агентов всех машин из админки (machines-roadmap п.16): сначала «канарейка» — одна устаревшая
// машина в сети; когда она вернулась с новой версией (родитель обновляет список по onRefresh), открывается
// кнопка «обновить остальные». Транспорта здесь нет — только колбэки родителя (границы admin-app).
import { useEffect, useMemo, useState } from 'react'
import type { AdminUserInfo } from '@shared/admin'
import { compareVersions } from '@shared/version'
import { Button } from '@voicechat/ui-kit'

export interface AgentFleetUpdateProps {
  users: AdminUserInfo[]
  /** Актуальная версия агента (AGENT_VERSION сервера). */
  latestVersion: string
  /** Запустить обновление на машине; вернуть текст ошибки или null. */
  onUpdate: (machineId: string) => Promise<string | null>
  /** Перечитать список пользователей/машин (версии приезжают с ним). */
  onRefresh?: () => void
}

interface FleetMachine { id: string; name: string; owner: string; online: boolean; version?: string; outdated: boolean }

export function fleetMachines(users: AdminUserInfo[], latestVersion: string): FleetMachine[] {
  return users.flatMap((u) => (u.agents ?? []).map((a) => ({
    id: a.id, name: a.name, owner: u.name, online: a.online, version: a.version,
    outdated: a.online && Boolean(a.version) && compareVersions(a.version!, latestVersion) < 0
  })))
}

export function AgentFleetUpdate({ users, latestVersion, onUpdate, onRefresh }: AgentFleetUpdateProps): JSX.Element | null {
  const machines = useMemo(() => fleetMachines(users, latestVersion), [users, latestVersion])
  const outdated = machines.filter((m) => m.outdated)
  const [canaryId, setCanaryId] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [phase, setPhase] = useState<'idle' | 'canary' | 'fleet' | 'done'>('idle')

  const canary = canaryId ? machines.find((m) => m.id === canaryId) : undefined
  const canaryOk = Boolean(canary && canary.online && canary.version && compareVersions(canary.version, latestVersion) >= 0)

  // Пока ждём возврата канарейки с новой версией, перечитываем список раз в 5 с.
  useEffect(() => {
    if (phase !== 'canary' || canaryOk || !onRefresh) return
    const timer = setInterval(onRefresh, 5000)
    return () => clearInterval(timer)
  }, [phase, canaryOk, onRefresh])

  const run = async (ids: string[]): Promise<void> => {
    setBusy(new Set(ids))
    const next: Record<string, string> = {}
    await Promise.all(ids.map(async (id) => { const err = await onUpdate(id); if (err) next[id] = err }))
    setErrors((cur) => ({ ...cur, ...next }))
    setBusy(new Set())
  }
  const startCanary = async (): Promise<void> => {
    const pick = outdated[0]
    if (!pick) return
    setCanaryId(pick.id)
    setPhase('canary')
    await run([pick.id])
  }
  const updateRest = async (): Promise<void> => {
    setPhase('fleet')
    await run(outdated.filter((m) => m.id !== canaryId).map((m) => m.id))
    setPhase('done')
  }

  if (machines.length === 0) return null
  return (
    <section className="uadmin-sec" data-testid="agent-fleet-update" aria-label="Обновление агентов">
      <div className="uusage-heading">
        <div>
          <h3 className="uadmin-h">Агенты машин</h3>
          <p className="uusage-note">Актуальная версия v{latestVersion}. Устарели и в сети: {outdated.length} из {machines.length}.</p>
        </div>
        <div className="fleet-actions">
          {phase === 'idle' && <Button size="sm" variant="primary" disabled={outdated.length === 0} onClick={() => void startCanary()}>Канарейка: обновить одну</Button>}
          {phase === 'canary' && !canaryOk && <span role="status">⏳ Ждём «{canary?.name}» с v{latestVersion}…</span>}
          {phase === 'canary' && canaryOk && <Button size="sm" variant="primary" disabled={outdated.length === 0} onClick={() => void updateRest()}>✓ Канарейка ок — обновить остальные ({outdated.length})</Button>}
          {phase === 'fleet' && <span role="status">⏳ Обновляем остальные…</span>}
          {phase === 'done' && <span role="status">✓ Команды обновления отправлены; версии обновятся, когда агенты перезапустятся.</span>}
        </div>
      </div>
      <table className="utable" data-testid="fleet-table">
        <thead><tr><th>Машина</th><th>Владелец</th><th>Статус</th><th>Версия</th><th></th></tr></thead>
        <tbody>
          {machines.map((m) => (
            <tr key={m.id} data-testid={`fleet-row-${m.id}`}>
              <td>{m.name}{m.id === canaryId ? ' 🐤' : ''}</td>
              <td>{m.owner}</td>
              <td>{m.online ? 'в сети' : 'офлайн'}</td>
              <td>{m.version ? `v${m.version}` : '—'}{m.outdated ? ' · устарел' : ''}</td>
              <td>
                {m.outdated && <Button size="sm" disabled={busy.has(m.id)} aria-label={`Обновить агента на ${m.name}`} onClick={() => void run([m.id])}>{busy.has(m.id) ? 'Запускаем…' : 'Обновить'}</Button>}
                {errors[m.id] && <span role="alert" className="fleet-err"> {errors[m.id]}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
