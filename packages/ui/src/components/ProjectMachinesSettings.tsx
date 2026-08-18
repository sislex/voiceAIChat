import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
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
const tableStyle: CSSProperties = { minWidth: 1600, width: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }
const headCellStyle: CSSProperties = { padding: '11px 12px', textAlign: 'left', verticalAlign: 'bottom', color: 'var(--text-dim)', background: 'var(--panel)', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }
const cellStyle: CSSProperties = { padding: '12px', verticalAlign: 'top', borderBottom: '1px solid var(--border-soft)', color: 'var(--text)' }
const inputStyle: CSSProperties = { boxSizing: 'border-box', width: '100%', minWidth: 180, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-medium)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit' }
const controlCellStyle: CSSProperties = { ...cellStyle, textAlign: 'center', verticalAlign: 'middle' }
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
function Table(p: { title: string; empty: string; projectId: string; machines: ProjectMachine[]; own: boolean; onShare: ProjectMachinesSettingsProps['onShare']; onSave: ProjectMachinesSettingsProps['onSave']; onSetDefault: ProjectMachinesSettingsProps['onSetDefault'] }): JSX.Element {
  return <section className="proj-section" style={sectionStyle}><h3 style={{ margin: '0 0 14px', fontSize: 18 }}>{p.title}</h3>{p.machines.length === 0 ? <p className="proj-muted" style={{ margin: 0 }}>{p.empty}</p> :
    <div style={tableWrapStyle}><table className="proj-machines-table" style={tableStyle}>
      <colgroup>
        <col style={{ width: 180 }} /><col style={{ width: 150 }} /><col style={{ width: 130 }} />
        <col style={{ width: 120 }} /><col style={{ width: 190 }} />
        <col style={{ width: 230 }} /><col style={{ width: 230 }} /><col style={{ width: 200 }} /><col style={{ width: 170 }} />
      </colgroup>
      <thead><tr>
        <th scope="col" style={headCellStyle}>Имя</th>
        <th scope="col" style={headCellStyle}>Онлайн</th>
        <th scope="col" style={headCellStyle}>Владелец</th>
        <th scope="col" style={{ ...headCellStyle, textAlign: 'center' }}>По умолчанию</th>
        <th scope="col" style={{ ...headCellStyle, textAlign: 'center' }}>Предоставить этому проекту</th>
        {fields.map(({ key, label }) => <th key={key} scope="col" style={headCellStyle}>{label}</th>)}
      </tr></thead>
      <tbody>{p.machines.map((m) => <tr key={m.agentId}>
        <td style={cellStyle}><strong>{m.name ?? m.agentId}</strong></td>
        <td style={cellStyle}><span className={m.online ? 'proj-online' : 'proj-offline'}>{m.online ? '● online' : '○ offline'}</span>
          <span className="proj-muted" style={{ display: 'block', marginTop: 4, fontSize: 11 }}>Загрузка: {m.load ?? 0}</span>
          {m.canUse === false && <span className="proj-offline" style={{ display: 'block', marginTop: 4, fontSize: 11 }}>{m.unavailableReason ?? 'недоступна'}</span>}
        </td>
        <td style={cellStyle}>{m.owner ?? '—'}</td>
        <td style={controlCellStyle}><input type="radio" name="project-machine-default" aria-label={`По умолчанию: ${m.name ?? m.agentId}`} checked={m.isMyDefault === true}
          disabled={m.canUse === false || m.online === false || (p.own && !m.sharedWithProject)} onChange={() => void p.onSetDefault(p.projectId, m.agentId)} /></td>
        <td style={controlCellStyle}>{p.own
          ? <input type="checkbox" aria-label={`Предоставить текущему проекту: ${m.name ?? m.agentId}`} checked={m.sharedWithProject === true}
              onChange={(e) => void p.onShare(p.projectId, m.agentId, e.target.checked)} />
          : <input type="checkbox" aria-label={`Предоставлена текущему проекту: ${m.name ?? m.agentId}`} checked disabled />}</td>
        <ConfigCells projectId={p.projectId} machine={m} readonly={!p.own || !m.sharedWithProject} onSave={p.onSave} />
      </tr>)}</tbody>
    </table></div>}</section>
}
export function ProjectMachinesSettings(p: ProjectMachinesSettingsProps): JSX.Element {
  const own = new Map(p.machines.filter((m) => m.ownership === 'mine').map((m) => [m.agentId, m]))
  const mine = p.agents.map((a) => own.get(a.id) ?? ({ agentId: a.id, name: a.name, owner: 'вы', ownership: 'mine', online: a.online, sharedWithProject: false, isMyDefault: false, canUse: true, unavailableReason: null, load: 0, path: '', reposRoot: '', sshHost: '', sshUser: '' } satisfies ProjectMachine))
  const shared = p.machines.filter((m) => m.ownership === 'other' && m.sharedWithProject)
  return <div data-testid="project-machines-settings"><Table title="Мои машины" empty="Нет машин — добавьте машину в меню «Машины»." projectId={p.projectId} machines={mine} own onShare={p.onShare} onSave={p.onSave} onSetDefault={p.onSetDefault} />
    <Table title="Машины, предоставленные проекту" empty="Нет машин, предоставленных проекту." projectId={p.projectId} machines={shared} own={false} onShare={p.onShare} onSave={p.onSave} onSetDefault={p.onSetDefault} /></div>
}
