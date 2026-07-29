// Отдельное меню «Машины»: таблица агентских машин со статусом (запущен ли агент),
// ОС, загрузкой CPU/памяти, диском и (для Android) батареей, а также быстрыми
// чекбоксами разрешений (сеть / запись файлов). Полный редактор политики —
// по-прежнему в «Настройках» (AgentCard). Данные приходят живым пушем (state.agents).

import { useState } from 'react'
import type { AgentCreated, AgentInfo, AgentPolicy, AgentTelemetry, DiskUsage } from '@shared/agentProtocol'
import { AGENT_VERSION, compareVersions } from '@shared/version'
import { agentOsFromPlatform, installCommand, UPDATE_HINT } from '@shared/agentInstall'
import { copyText } from '../lib/clipboard'
import { AgentCommands } from './AgentCommands'
import { ToolFrame } from './ToolFrame'

export interface MachineStatusProps {
  /** Размещение: модалка из меню (по умолчанию) или страница контентной колонки. */
  variant?: 'modal' | 'page'
  agents: AgentInfo[]
  /** Быстрое изменение разрешений (сервер сразу применит онлайн-агенту). */
  onSetPolicy: (id: string, policy: AgentPolicy) => void
  /** Добавить машину; вернёт токен один раз. Нет — блок добавления скрыт. */
  onCreateAgent?: (name: string) => Promise<AgentCreated | null>
  /** Перевыпустить токен машины (старый перестаёт работать). */
  onRegenerateToken?: (id: string) => Promise<string | null>
  /** Строка подключения по токену — из неё собираются команды установки. */
  onGetConnectionString?: (token: string) => Promise<string | null>
  /** Обновить агента на машине (сервер выполнит на ней команду установки). */
  onUpdateAgent?: (id: string) => Promise<string | null>
  /** Машина по умолчанию для новых разговоров (radio). */
  defaultAgentId?: string | null
  /** Выбрать/снять машину по умолчанию (повторный клик по выбранной — сброс). */
  onSetDefault?: (id: string | null) => void
  onClose: () => void
}

/** Устарел ли агент относительно версии, которую отдаёт сервер. */
function isOutdated(a: AgentInfo): boolean {
  return Boolean(a.online && a.version && compareVersions(a.version, AGENT_VERSION) < 0)
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

/** Кнопки обслуживания агента в строке машины. */
function AgentActions({
  agent,
  onUpdate,
  onCopyCommand,
  onRegenerate,
  busy,
  copied
}: {
  agent: AgentInfo
  onUpdate?: () => void
  onCopyCommand?: () => void
  onRegenerate?: () => void
  busy: boolean
  copied: boolean
}): JSX.Element {
  const outdated = isOutdated(agent)
  return (
    <td className="mst-agent">
      <span className={outdated ? 'mst-ver outdated' : 'mst-ver'}>
        {agent.version ? `v${agent.version}` : '—'}
        {outdated && <span className="mst-badge">устарел, есть v{AGENT_VERSION}</span>}
      </span>
      <span className="mst-agent-btns">
        {outdated && onCopyCommand && (
          <button
            className="mst-btn"
            title={`Скопировать команду обновления. ${UPDATE_HINT}`}
            aria-label={`Скопировать команду обновления для ${agent.name}`}
            onClick={onCopyCommand}
          >
            {copied ? '✓ скопировано' : '⧉ команда'}
          </button>
        )}
        {outdated && onUpdate && (
          <button
            className="mst-btn primary"
            title="Обновить агента на машине: сервер выполнит на ней ту же команду"
            aria-label={`Обновить агента на ${agent.name}`}
            disabled={busy}
            onClick={onUpdate}
          >
            {busy ? 'обновляю…' : '⬆ обновить'}
          </button>
        )}
        {onRegenerate && (
          <button
            className="mst-btn"
            title="Перевыпустить токен: старый перестанет работать, агента нужно переустановить новой командой"
            aria-label={`Перевыпустить токен для ${agent.name}`}
            onClick={onRegenerate}
          >
            ↻ токен
          </button>
        )}
      </span>
    </td>
  )
}

export function MachineStatus({
  agents,
  onSetPolicy,
  onCreateAgent,
  onRegenerateToken,
  onGetConnectionString,
  onUpdateAgent,
  defaultAgentId,
  onSetDefault,
  onClose,
  variant = 'modal'
}: MachineStatusProps): JSX.Element {
  const [name, setName] = useState('')
  const [created, setCreated] = useState<AgentCreated | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const add = async (): Promise<void> => {
    const n = name.trim()
    if (!n || !onCreateAgent) return
    const agent = await onCreateAgent(n)
    if (!agent) {
      setNote('Не удалось добавить машину')
      return
    }
    setCreated(agent)
    setName('')
    setNote(null)
  }

  const regenerate = async (a: AgentInfo): Promise<void> => {
    if (!onRegenerateToken) return
    const token = await onRegenerateToken(a.id)
    if (!token) {
      setNote('Не удалось перевыпустить токен')
      return
    }
    // Показываем тот же блок команд: с новым токеном агента надо переустановить.
    setCreated({ id: a.id, name: a.name, token })
    setNote(null)
  }

  const update = async (a: AgentInfo): Promise<void> => {
    if (!onUpdateAgent) return
    setBusyId(a.id)
    setNote(null)
    const err = await onUpdateAgent(a.id)
    setBusyId(null)
    // Установщик запускается отвязанно, поэтому его провал сюда не доходит:
    // единственный честный признак успеха — сменившаяся версия в этой же строке.
    setNote(
      err ??
        `Обновление на «${a.name}» запущено. Через полминуты версия в строке должна стать v${AGENT_VERSION}; ` +
          'если нет — скопируйте команду обновления и запустите её на машине, ошибка будет видна в терминале.'
    )
  }

  // Команда обновления собирается без токена: установщик на машине достанет
  // строку подключения сам (из своего файла или у живого агента).
  const copyUpdateCommand = async (a: AgentInfo): Promise<void> => {
    const os = a.telemetry ? agentOsFromPlatform(a.telemetry.os.platform, a.telemetry.os.isAndroid) : null
    if (!os) {
      setNote('Не удалось определить ОС машины — обновите вручную из настроек')
      return
    }
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    if (await copyText(installCommand(os, base))) {
      setCopiedId(a.id)
      setTimeout(() => setCopiedId((c) => (c === a.id ? null : c)), 2000)
    }
  }

  return (
    <ToolFrame title="Машины" variant={variant} onClose={onClose} testId="machines-overlay">
      <div className="mst-body">
        {agents.length === 0 ? (
          <p className="mst-empty">Нет добавленных машин — добавьте первую ниже.</p>
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
                {onSetDefault && <th>По умолчанию</th>}
                <th>Агент</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} data-testid={`machine-row-${a.id}`}>
                  <td className="mst-name">{a.name}</td>
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
                  {onSetDefault && (
                    <td className="mst-default">
                      <input
                        type="radio"
                        name="default-machine"
                        checked={a.id === defaultAgentId}
                        aria-label={`Сделать «${a.name}» машиной по умолчанию`}
                        title="Использовать по умолчанию в новых разговорах"
                        onChange={() => onSetDefault(a.id)}
                        onClick={() => { if (a.id === defaultAgentId) onSetDefault(null) }}
                      />
                    </td>
                  )}
                  <AgentActions
                    agent={a}
                    busy={busyId === a.id}
                    copied={copiedId === a.id}
                    onUpdate={onUpdateAgent ? () => void update(a) : undefined}
                    onCopyCommand={() => void copyUpdateCommand(a)}
                    onRegenerate={onRegenerateToken ? () => void regenerate(a) : undefined}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {note && (
          <p className="mst-note" role="status">
            {note}
          </p>
        )}

        {created && onGetConnectionString && (
          <AgentCommands
            name={created.name}
            token={created.token}
            onGetConnectionString={onGetConnectionString}
            onHide={() => setCreated(null)}
          />
        )}

        {onCreateAgent && (
          <div className="mst-add">
            <input
              className="sel"
              type="text"
              aria-label="Имя новой машины"
              placeholder="Имя машины (напр. MacBook)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
            />
            <button
              className="mst-btn primary"
              title="Добавить машину и получить команду установки"
              aria-label="Добавить машину"
              disabled={!name.trim()}
              onClick={() => void add()}
            >
              ＋ Добавить машину
            </button>
          </div>
        )}

        <p className="mst-hint">
          Телеметрия обновляется каждые 30 секунд, пока агент в сети (нужна версия агента 0.4+).
          Полное управление разрешениями — в «Настройках».
        </p>
      </div>
    </ToolFrame>
  )
}
