// Системные метрики установки: машины, ролевые правила команд, место на диске.
//
// Живут на своей странице `#/users/system`, а не в списке людей: к конкретному
// человеку они отношения не имеют, а обход диска ради метрик Make заметно
// удорожал открытие раздела «Пользователи».

import type { AdminMachineStats, AdminMakeStats } from '@shared/admin'
import type { RoleCommandPolicies } from '@shared/commandPolicy'
import { RoleCommandPolicyEditor } from '../RoleCommandPolicyEditor'
import { EmptyState } from '@voicechat/ui-kit'

/** Байты человеку: КБ до мегабайта, дальше МБ с одним знаком. */
function mb(n: number): string { return n < 1048576 ? `${Math.round(n / 1024)} КБ` : `${(n / 1048576).toFixed(1)} МБ` }

export interface SystemPageProps {
  /** Массовое обновление агентов — состояние парка машин, а не свойство человека. */
  fleetSlot?: React.ReactNode
  machineStats?: AdminMachineStats | null
  makeStats?: AdminMakeStats | null
  roleCommandPolicies?: RoleCommandPolicies | null
  onSaveRoleCommandPolicies?: (roles: RoleCommandPolicies) => Promise<void>
}

export function SystemPage({ fleetSlot, machineStats = null, makeStats = null, roleCommandPolicies = null, onSaveRoleCommandPolicies }: SystemPageProps): JSX.Element {
  const empty = !fleetSlot && !machineStats?.machines.length && !makeStats && !roleCommandPolicies
  return (
    <div data-testid="system-page">
      {empty && <EmptyState icon="⚙" title="Метрик пока нет" description="Появятся, когда подключатся машины или заработают проекты Make." />}
      {fleetSlot}
      {machineStats && machineStats.machines.length > 0 && (
        <section className="uadmin-sec" data-testid="machine-stats">
          <div className="uusage-heading"><div><h3 className="uadmin-h">Машины</h3><p className="uusage-note">В сети {machineStats.totals.online} из {machineStats.totals.machines} · команд за 24 ч: {machineStats.totals.commands24h} · с ошибкой: {machineStats.totals.errors24h} · Prometheus: <code>/api/admin/machines/metrics</code></p></div></div>
          <table className="utable"><thead><tr><th>Машина</th><th>Владелец</th><th>Статус</th><th>Команд 24 ч / всего</th><th>Ошибок 24 ч</th><th>Ср. длительность</th><th>Тревог 30 д</th><th>CPU</th><th>Память</th><th>Диск</th></tr></thead><tbody>
            {machineStats.machines.map((m) => (
              <tr key={m.id} className={m.errors24h > 0 || m.offlineEvents30d > 0 ? 'uadmin-warn' : undefined}>
                <td>{m.name}{m.version ? ` · v${m.version}` : ''}</td><td>{m.owner}</td><td>{m.online ? 'в сети' : 'офлайн'}</td>
                <td>{m.commands24h} / {m.commandsTotal}</td><td>{m.errors24h}</td><td>{m.avgDurationMs24h ? `${(m.avgDurationMs24h / 1000).toFixed(1)} с` : '—'}</td>
                <td>{m.offlineEvents30d}{m.offlineMs30d ? ` (${Math.round(m.offlineMs30d / 60000)} мин)` : ''}</td>
                <td>{m.cpuLoadPct !== undefined ? `${Math.round(m.cpuLoadPct)}%` : '—'}</td><td>{m.memUsedRatio !== undefined ? `${Math.round(m.memUsedRatio * 100)}%` : '—'}</td><td>{m.diskFreeBytes !== undefined ? `${mb(m.diskFreeBytes)} своб.` : '—'}</td>
              </tr>
            ))}
          </tbody></table>
        </section>
      )}
      {roleCommandPolicies && onSaveRoleCommandPolicies && (
        <RoleCommandPolicyEditor roles={roleCommandPolicies} onSave={onSaveRoleCommandPolicies} />
      )}
      {makeStats && (
        <section className="uadmin-sec" data-testid="make-stats">
          <h3 className="uadmin-h">Make-проекты</h3>
          {makeStats.disk && <p className={makeStats.disk.alert ? 'uusage-note uusage-disk uusage-disk--alert' : 'uusage-note uusage-disk'} role={makeStats.disk.alert ? 'alert' : undefined} data-testid="admin-disk">{makeStats.disk.alert ? '⚠ ' : ''}Диск с данными: свободно {mb(makeStats.disk.freeBytes)} из {mb(makeStats.disk.totalBytes)}{makeStats.disk.alert ? ' — меньше 10 ГБ, релизы упрутся в проверку места; очистите docker/логи' : ''}</p>}
          <p className="uusage-note">Проектов: {makeStats.projects} · занято {mb(makeStats.bytes)} (файлы {mb(makeStats.filesBytes)}, снимки {mb(makeStats.snapshotsBytes)}, PNG стори {mb(makeStats.shotsBytes)}) · опубликовано {makeStats.published} · read-only ссылок {makeStats.shared} · просмотров публикаций {makeStats.views} · квота на проект {mb(makeStats.limitBytes)} · на пользователя {mb(makeStats.userLimitBytes)}</p>
          {makeStats.byUser.length > 0 && (
            <table className="utable"><thead><tr><th>Пользователь</th><th>Проектов</th><th>Занято</th><th>Опубликовано</th><th>Просмотров</th></tr></thead><tbody>
              {makeStats.byUser.map((u) => { const share = makeStats.userLimitBytes ? u.bytes / makeStats.userLimitBytes : 0; return <tr key={u.user} className={share >= 0.8 ? 'uadmin-warn' : undefined} data-testid={share >= 0.8 ? 'make-user-quota-warn' : undefined}><td>{u.user}</td><td>{u.projects}</td><td>{mb(u.bytes)}{share >= 0.8 ? ` ⚠ ${Math.round(share * 100)}% квоты` : ''}</td><td>{u.published}</td><td>{u.views}</td></tr> })}
            </tbody></table>
          )}
          {makeStats.top.length > 0 && (
            <details className="uusage-details"><summary>Самые тяжёлые проекты ({makeStats.top.length})</summary>
              <table className="utable"><thead><tr><th>Проект</th><th>Владелец</th><th>Файлов</th><th>Снимков</th><th>Занято</th><th>Публикация</th></tr></thead><tbody>
                {makeStats.top.map((p) => <tr key={p.conversationId}><td><code>{p.conversationId.slice(0, 8)}</code></td><td>{p.owner ?? '—'}</td><td>{p.filesCount}</td><td>{p.snapshots}</td><td>{mb(p.bytes)}</td><td>{p.published ? `да · ${p.views} просм.` : '—'}{p.shared ? ' · read-only' : ''}</td></tr>)}
              </tbody></table>
            </details>
          )}
        </section>
      )}
    </div>
  )
}
