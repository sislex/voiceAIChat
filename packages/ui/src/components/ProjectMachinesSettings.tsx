import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AgentInfo } from '@shared/agentProtocol'
import type { ProjectMachine } from '@shared/projects'

type Field = 'path' | 'reposRoot' | 'sshHost' | 'sshUser'
export interface ProjectMachinesSettingsProps {
  projectId: string; machines: ProjectMachine[]; agents: AgentInfo[]
  onShare: (projectId: string, agentId: string, shared: boolean) => void | Promise<void>
  onSave: (projectId: string, agentId: string, field: Field, value: string, machine: ProjectMachine) => void | Promise<void>
  onSetDefault: (projectId: string, agentId: string) => void | Promise<void>
}
const fields: Array<{ key: Field; label: string; help: string }> = [
  { key: 'path', label: 'Папка проекта', help: 'Абсолютный путь к checkout проекта; рабочий каталог задач, команд, консоли и проводника.' },
  { key: 'reposRoot', label: 'Корень Feature Run', help: 'Корневая папка VoiceAIChatRepos для рабочих каталогов и репозиториев Feature Run/CI.' },
  { key: 'sshHost', label: 'SSH hostname/IP', help: 'Hostname, DNS-имя или IP для SSH-подключения и операций проекта.' },
  { key: 'sshUser', label: 'SSH-пользователь', help: 'Системный пользователь для SSH-подключения.' }
]
const sectionStyle: CSSProperties = { marginTop: 20, padding: 20, border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-medium)', background: 'var(--surface)' }
const tableWrapStyle: CSSProperties = { overflowX: 'auto', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-medium)' }
type ColumnKey = 'name' | 'readiness' | 'default' | 'share' | Field
type StatusFilter = 'online' | 'offline' | 'all'
const columns: Array<{ key: ColumnKey; label: string; min: number }> = [
  { key: 'name', label: 'Имя', min: 180 },
  { key: 'readiness', label: 'Готовность', min: 108 },
  { key: 'default', label: 'По умолчанию', min: 120 },
  { key: 'share', label: 'Предоставить этому проекту', min: 190 },
  ...fields.map(({ key, label }) => ({ key, label, min: 170 }))
]
const tableStyle: CSSProperties = { width: 'max-content', minWidth: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }
const headCellStyle: CSSProperties = { position: 'relative', boxSizing: 'border-box', padding: '11px 18px 11px 12px', textAlign: 'left', verticalAlign: 'bottom', color: 'var(--text-dim)', background: 'var(--panel)', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }
const cellStyle: CSSProperties = { boxSizing: 'border-box', padding: '12px', verticalAlign: 'top', borderBottom: '1px solid var(--border-soft)', color: 'var(--text)', overflow: 'hidden' }
const inputStyle: CSSProperties = { boxSizing: 'border-box', width: '100%', minWidth: 0, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-medium)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit' }
const controlCellStyle: CSSProperties = { ...cellStyle, textAlign: 'center', verticalAlign: 'middle' }

function Tooltip({ text, ariaLabel = text, className, children }: { text: string; ariaLabel?: string; className?: string; children?: ReactNode }): JSX.Element {
  const target = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const show = (): void => {
    const rect = target.current?.getBoundingClientRect()
    if (rect) setPosition({ left: rect.left + rect.width / 2, top: rect.bottom + 7 })
  }
  return <>
    <span ref={target} className={className} role="img" title={text} aria-label={ariaLabel} tabIndex={0} onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocus={show} onBlur={() => setPosition(null)}>{children}</span>
    {position && createPortal(<span role="tooltip" className="proj-machine-tooltip" style={{ left: position.left, top: position.top }}>{text}</span>, document.body)}
  </>
}

export function machineReadiness(machine: Pick<ProjectMachine, 'online' | 'path' | 'reposRoot'>): { ready: boolean; reasons: string[]; tooltip: string } {
  const reasons: string[] = []
  if (machine.online !== true) reasons.push('Offline')
  if (!machine.path.trim()) reasons.push('не заполнена «Папка проекта»')
  if (!machine.reposRoot.trim()) reasons.push('не заполнен «Корень Feature Run»')
  return { ready: reasons.length === 0, reasons, tooltip: reasons.length === 0 ? 'Готова' : `Не готова: ${reasons.join('; ')}` }
}

function contentWidth(value: string, min: number): number {
  return Math.min(520, Math.max(min, Math.ceil(value.length * 7.4 + 32)))
}
function initialColumnWidths(machines: ProjectMachine[]): Record<ColumnKey, number> {
  const values: Record<ColumnKey, string[]> = {
    name: machines.map((m) => `${m.name ?? m.agentId} ${m.owner ?? '—'}`),
    readiness: [],
    default: [], share: [],
    path: machines.map((m) => m.path),
    reposRoot: machines.map((m) => m.reposRoot),
    sshHost: machines.map((m) => m.sshHost ?? ''),
    sshUser: machines.map((m) => m.sshUser ?? '')
  }
  return Object.fromEntries(columns.map(({ key, label, min }) => [key, Math.max(contentWidth(label, min), ...values[key].map((value) => contentWidth(value, min)))])) as Record<ColumnKey, number>
}
function ResizableHeader({ column, width, onResize }: { column: typeof columns[number]; width: number; onResize: (key: ColumnKey, width: number) => void }): JSX.Element {
  const start = (clientX: number): void => {
    const initialX = clientX
    const initialWidth = width
    const move = (event: PointerEvent): void => onResize(column.key, Math.max(column.min, initialWidth + event.clientX - initialX))
    const stop = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  return <th scope="col" style={{ ...headCellStyle, textAlign: column.key === 'default' || column.key === 'share' ? 'center' : 'left' }}>
    {column.label}
    <span role="separator" aria-label={`Изменить ширину столбца «${column.label}»`} aria-orientation="vertical"
      aria-valuemin={column.min} aria-valuemax={1000} aria-valuenow={width} tabIndex={0}
      style={{ position: 'absolute', top: 0, right: -3, width: 8, height: '100%', cursor: 'col-resize', touchAction: 'none', borderRight: '1px solid var(--border-soft)', zIndex: 1 }}
      onPointerDown={(event) => { event.preventDefault(); start(event.clientX) }}
      onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onResize(column.key, Math.max(column.min, width + (event.key === 'ArrowRight' ? 16 : -16))) } }} />
  </th>
}
function ConfigCells({ projectId, machine, readonly, onSave }: { projectId: string; machine: ProjectMachine; readonly: boolean; onSave: ProjectMachinesSettingsProps['onSave'] }): JSX.Element {
  const values = (): Record<Field, string> => ({ path: machine.path, reposRoot: machine.reposRoot, sshHost: machine.sshHost ?? '', sshUser: machine.sshUser ?? '' })
  const [draft, setDraft] = useState(values)
  const [status, setStatus] = useState<Partial<Record<Field, 'saving' | 'saved' | 'error'>>>({})
  useEffect(() => setDraft(values()), [machine.path, machine.reposRoot, machine.sshHost, machine.sshUser])
  const commit = async (key: Field): Promise<void> => {
    if (readonly || draft[key] === values()[key] || status[key] === 'saving') return
    setStatus((s) => ({ ...s, [key]: 'saving' }))
    try { await onSave(projectId, machine.agentId, key, draft[key], { ...machine, ...draft }); setStatus((s) => ({ ...s, [key]: 'saved' })) }
    catch { setStatus((s) => ({ ...s, [key]: 'error' })) }
  }
  return <>{fields.map(({ key, label, help }) => {
    const inputId = `project-machine-${machine.agentId}-${key}`
    return <td key={key} className="proj-machine-field" style={cellStyle}>
      <label htmlFor={inputId} style={{ display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 700 }}>
        {label} <span title={help} aria-label={`Подсказка: ${label} — ${machine.name ?? machine.agentId}`} tabIndex={0} style={{ cursor: 'help', color: 'var(--text-dim)' }}>ⓘ</span>
      </label>
      <input id={inputId} className="login-input" style={{ ...inputStyle, opacity: readonly ? 0.72 : 1 }} aria-label={`${label}: ${machine.name ?? machine.agentId}`} readOnly={readonly} value={draft[key]}
        onChange={(e) => setDraft((v) => ({ ...v, [key]: e.target.value }))} onBlur={() => void commit(key)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commit(key) } }} />
      {status[key] === 'saving' && <span role="status">Сохранение…</span>}
      {status[key] === 'saved' && <span role="status">Сохранено</span>}
      {status[key] === 'error' && <span role="alert">Не удалось сохранить</span>}
    </td>
  })}</>
}
function Table(p: { title: string; empty: string; projectId: string; machines: ProjectMachine[]; own: boolean; widths: Record<ColumnKey, number>; onResize: (key: ColumnKey, width: number) => void; onShare: ProjectMachinesSettingsProps['onShare']; onSave: ProjectMachinesSettingsProps['onSave']; onSetDefault: ProjectMachinesSettingsProps['onSetDefault'] }): JSX.Element {
  const [filter, setFilter] = useState<StatusFilter>('online')
  const filtered = p.machines.filter((machine) => filter === 'all' || (machine.online === true) === (filter === 'online'))
  return <section className="proj-section" style={sectionStyle}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
      <h3 style={{ margin: 0, fontSize: 18 }}>{p.title}</h3>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-dim)', fontSize: 13 }}>
        <span aria-hidden="true">⌄</span><span>Фильтр</span>
        <select aria-label={`Фильтр машин: ${p.title}`} value={filter} onChange={(event) => setFilter(event.target.value as StatusFilter)} className="login-input" style={{ padding: '6px 28px 6px 9px', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-medium)' }}>
          <option value="online">Онлайн</option><option value="offline">Офлайн</option><option value="all">Все</option>
        </select>
      </label>
    </div>
    {filtered.length === 0 ? <p className="proj-muted" style={{ margin: 0 }}>{p.machines.length === 0 ? p.empty : 'Нет машин, соответствующих фильтру.'}</p> :
    <div style={tableWrapStyle}><table className="proj-machines-table" style={tableStyle}>
      <colgroup>{columns.map(({ key }) => <col key={key} style={{ width: p.widths[key] }} />)}</colgroup>
      <thead><tr>{columns.map((column) => <ResizableHeader key={column.key} column={column} width={p.widths[column.key]} onResize={p.onResize} />)}</tr></thead>
      <tbody>{filtered.map((m) => { const readiness = machineReadiness(m); return <tr key={m.agentId}>
        <td style={cellStyle}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Tooltip className={`proj-status-dot ${m.online === true ? 'proj-status-dot--online' : 'proj-status-dot--offline'}`} text={m.online === true ? 'Online' : 'Offline'} />
            <strong style={{ overflowWrap: 'anywhere' }}>{m.name ?? m.agentId}</strong>
          </span>
          <span className="proj-muted" style={{ display: 'block', marginTop: 4, paddingLeft: 20, fontSize: 11, fontWeight: 400, overflowWrap: 'anywhere' }}>{m.owner ?? '—'}</span>
          <Tooltip className="proj-muted proj-machine-load" text="Количество активных CI-запусков, назначенных этой машине" ariaLabel={`Загрузка: ${m.load ?? 0}. Количество активных CI-запусков, назначенных этой машине`}>Загрузка: {m.load ?? 0} <span aria-hidden="true">ⓘ</span></Tooltip>
          {m.canUse === false && <span className="proj-offline" style={{ display: 'block', marginTop: 4, paddingLeft: 20, fontSize: 11 }}>{m.unavailableReason ?? 'недоступна'}</span>}
        </td>
        <td style={controlCellStyle}><Tooltip className={`proj-status-dot ${readiness.ready ? 'proj-status-dot--ready' : 'proj-status-dot--not-ready'}`} text={readiness.tooltip} /></td>
        <td style={controlCellStyle}><input type="radio" name="project-machine-default" aria-label={`По умолчанию: ${m.name ?? m.agentId}`} checked={m.isMyDefault === true}
          disabled={m.canUse === false || m.online !== true} onChange={() => void p.onSetDefault(p.projectId, m.agentId)} /></td>
        <td style={controlCellStyle}>{p.own
          ? <input type="checkbox" aria-label={`Предоставить текущему проекту: ${m.name ?? m.agentId}`} checked={m.sharedWithProject === true}
              onChange={(e) => void p.onShare(p.projectId, m.agentId, e.target.checked)} />
          : <input type="checkbox" aria-label={`Предоставлена текущему проекту: ${m.name ?? m.agentId}`} checked disabled />}</td>
        <ConfigCells projectId={p.projectId} machine={m} readonly={!p.own || !m.sharedWithProject} onSave={p.onSave} />
      </tr> })}</tbody>
    </table></div>}</section>
}
export function ProjectMachinesSettings(p: ProjectMachinesSettingsProps): JSX.Element {
  const own = new Map(p.machines.filter((m) => m.ownership === 'mine').map((m) => [m.agentId, m]))
  const mine = p.agents.map((a) => own.get(a.id) ?? ({ agentId: a.id, name: a.name, owner: 'вы', ownership: 'mine', online: a.online, sharedWithProject: false, isMyDefault: false, canUse: true, unavailableReason: null, load: 0, path: '', reposRoot: '', sshHost: '', sshUser: '' } satisfies ProjectMachine))
  const shared = p.machines.filter((m) => m.ownership === 'other' && m.sharedWithProject)
  const [widths, setWidths] = useState<Record<ColumnKey, number>>(() => initialColumnWidths([...mine, ...shared]))
  const resize = (key: ColumnKey, width: number): void => setWidths((current) => ({ ...current, [key]: Math.round(width) }))
  return <div data-testid="project-machines-settings"><Table title="Мои машины" empty="Нет машин — добавьте машину в меню «Машины»." projectId={p.projectId} machines={mine} own widths={widths} onResize={resize} onShare={p.onShare} onSave={p.onSave} onSetDefault={p.onSetDefault} />
    <Table title="Машины, предоставленные проекту" empty="Нет машин, предоставленных проекту." projectId={p.projectId} machines={shared} own={false} widths={widths} onResize={resize} onShare={p.onShare} onSave={p.onSave} onSetDefault={p.onSetDefault} /></div>
}
