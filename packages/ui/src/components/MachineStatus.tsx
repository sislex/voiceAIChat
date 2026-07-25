// Отдельное меню «Машины»: таблица агентских машин со статусом (запущен ли агент),
// ОС, загрузкой CPU/памяти, диском и (для Android) батареей, а также быстрыми
// чекбоксами разрешений (сеть / запись файлов). Полный редактор политики —
// по-прежнему в «Настройках» (AgentCard). Данные приходят живым пушем (state.agents).

import type { AgentInfo, AgentPolicy, AgentTelemetry, DiskUsage } from '@shared/agentProtocol'
import { ToolFrame } from './ToolFrame'

export interface MachineStatusProps {
  agents: AgentInfo[]
  /** Быстрое изменение разрешений (сервер сразу применит онлайн-агенту). */
  onSetPolicy: (id: string, policy: AgentPolicy) => void
  onClose: () => void
}

const GB = 1024 ** 3
const MB = 1024 ** 2

/** Человекочитаемый размер (ГБ/МБ). */
function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= GB) return `${(n / GB).toFixed(1)} ГБ`
  return `${Math.round(n / MB)} МБ`
}

function fmtDisk(d?: DiskUsage): string {
  if (!d) return '—'
  return `${fmtBytes(d.freeBytes)} своб. / ${fmtBytes(d.totalBytes)}`
}

/** Короткое имя ОС. */
function osLabel(os: AgentTelemetry['os']): string {
  if (os.isAndroid) return `Android · ${os.arch}`
  const name =
    os.platform === 'darwin'
      ? 'macOS'
      : os.platform === 'win32'
        ? 'Windows'
        : os.platform === 'linux'
          ? 'Linux'
          : os.platform
  return `${name} · ${os.arch}`
}

function ratioPct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0
}

/** Полоска-индикатор с подписью (CPU/RAM). */
function Meter({ value, label }: { value: number; label: string }): JSX.Element {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="mst-meter" title={`${label} (${v}%)`}>
      <div className={v >= 90 ? 'mst-meter-fill hot' : 'mst-meter-fill'} style={{ width: `${v}%` }} />
      <span className="mst-meter-label">{label}</span>
    </div>
  )
}

/** Ячейка телеметрии одной машины (или прочерк, если данных нет). */
function TelemetryCells({ t }: { t?: AgentTelemetry }): JSX.Element {
  if (!t) {
    return (
      <>
        <td className="mst-dim">—</td>
        <td className="mst-dim">—</td>
        <td className="mst-dim">—</td>
        <td className="mst-dim">—</td>
        <td className="mst-dim">—</td>
      </>
    )
  }
  const ramPct = ratioPct(t.mem.usedBytes, t.mem.totalBytes)
  return (
    <>
      <td>{osLabel(t.os)}</td>
      <td>
        <Meter value={t.cpu.loadPct} label={`${t.cpu.loadPct}% · ${t.cpu.count} ядр.`} />
      </td>
      <td>
        <Meter value={ramPct} label={`${fmtBytes(t.mem.usedBytes)} / ${fmtBytes(t.mem.totalBytes)}`} />
      </td>
      <td className="mst-disk">
        <div>
          <span className="mst-dim">/</span> {fmtDisk(t.disk.root)}
        </div>
        <div>
          <span className="mst-dim">раб.</span> {fmtDisk(t.disk.work)}
        </div>
      </td>
      <td>
        {t.battery ? (
          <span className={t.battery.percent <= 15 && !t.battery.charging ? 'mst-batt low' : 'mst-batt'}>
            {t.battery.charging ? '⚡ ' : '🔋 '}
            {t.battery.percent}%{t.battery.charging ? ' заряжается' : ''}
          </span>
        ) : (
          <span className="mst-dim">—</span>
        )}
      </td>
    </>
  )
}

/** Быстрый чекбокс одного булева разрешения. */
function PermToggle({
  checked,
  label,
  disabled,
  onToggle
}: {
  checked: boolean
  label: string
  disabled: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <label className={disabled ? 'mst-perm off' : 'mst-perm'} title={disabled ? 'Машина офлайн' : label}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} aria-label={label} />
      <span>{label}</span>
    </label>
  )
}

export function MachineStatus({ agents, onSetPolicy, onClose }: MachineStatusProps): JSX.Element {
  return (
    <ToolFrame title="Машины" onClose={onClose} testId="machines-overlay">
      <div className="mst-body">
        {agents.length === 0 ? (
          <p className="mst-empty">
            Нет добавленных машин. Добавьте машину в «Настройках» и подключите к ней агента.
          </p>
        ) : (
          <table className="mst" data-testid="machines-table">
            <thead>
              <tr>
                <th>Машина</th>
                <th>Статус</th>
                <th>ОС</th>
                <th>CPU</th>
                <th>Память</th>
                <th>Диск</th>
                <th>Батарея</th>
                <th>Разрешения</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} data-testid={`machine-row-${a.id}`}>
                  <td className="mst-name">
                    {a.name}
                    {a.version && <span className="mst-ver">v{a.version}</span>}
                  </td>
                  <td>
                    <span className={a.online ? 'mst-status on' : 'mst-status off'}>
                      <span className="mst-dot" aria-hidden />
                      {a.online ? 'агент запущен' : 'не запущен'}
                    </span>
                  </td>
                  <TelemetryCells t={a.online ? a.telemetry : undefined} />
                  <td className="mst-perms">
                    <PermToggle
                      checked={a.policy.allowNetwork}
                      label="Сеть"
                      disabled={!a.online}
                      onToggle={() => onSetPolicy(a.id, { ...a.policy, allowNetwork: !a.policy.allowNetwork })}
                    />
                    <PermToggle
                      checked={a.policy.allowWrite}
                      label="Запись файлов"
                      disabled={!a.online}
                      onToggle={() => onSetPolicy(a.id, { ...a.policy, allowWrite: !a.policy.allowWrite })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mst-hint">
          Телеметрия обновляется каждые 30 секунд, пока агент в сети (нужна версия агента 0.4+).
          Полное управление разрешениями — в «Настройках».
        </p>
      </div>
    </ToolFrame>
  )
}
