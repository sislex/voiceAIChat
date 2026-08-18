import { useEffect, useState } from 'react'
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
function Config({ projectId, machine, readonly, onSave }: { projectId: string; machine: ProjectMachine; readonly: boolean; onSave: ProjectMachinesSettingsProps['onSave'] }): JSX.Element {
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
  return <div className="proj-machine-cfg">{fields.map(({ key, label, help }) => <label key={key} className="proj-machine-field">
    <span>{label} <span title={help} aria-label={`Подсказка: ${label}`} tabIndex={0}>ⓘ</span></span>
    <input className="login-input" aria-label={`${label}: ${machine.name ?? machine.agentId}`} readOnly={readonly} value={draft[key]}
      onChange={(e) => setDraft((v) => ({ ...v, [key]: e.target.value }))} onBlur={() => void commit(key)}
      onKeyDown={(e) => { if (e.key === 'Enter') void commit(key) }} />
    {status[key] === 'saving' && <span role="status">Сохранение…</span>}
    {status[key] === 'saved' && <span role="status">Сохранено</span>}
    {status[key] === 'error' && <span role="alert">Не удалось сохранить</span>}
  </label>)}</div>
}
function Table(p: { title: string; empty: string; projectId: string; machines: ProjectMachine[]; own: boolean; onShare: ProjectMachinesSettingsProps['onShare']; onSave: ProjectMachinesSettingsProps['onSave']; onSetDefault: ProjectMachinesSettingsProps['onSetDefault'] }): JSX.Element {
  return <section className="proj-section"><h3>{p.title}</h3>{p.machines.length === 0 ? <p className="proj-muted">{p.empty}</p> :
    <table className="proj-machines"><tbody>{p.machines.map((m) => <tr key={m.agentId}><td>
      <strong>{m.name ?? m.agentId}</strong><span className="proj-muted"> · владелец: {m.owner ?? '—'}</span>
      <span className={m.online ? 'proj-online' : 'proj-offline'}> · {m.online ? 'online' : 'offline'}</span>
      <span className="proj-muted"> · загрузка: {m.load ?? 0}</span>
      {m.canUse === false && <span className="proj-offline"> · {m.unavailableReason ?? 'недоступна'}</span>}
      {p.own && <label><input type="checkbox" aria-label={`Предоставить текущему проекту: ${m.name ?? m.agentId}`} checked={m.sharedWithProject === true}
        onChange={(e) => void p.onShare(p.projectId, m.agentId, e.target.checked)} /> Предоставить текущему проекту</label>}
      <label><input type="radio" name="project-machine-default" aria-label={`По умолчанию: ${m.name ?? m.agentId}`} checked={m.isMyDefault === true}
        disabled={m.canUse === false || m.online === false || (p.own && !m.sharedWithProject)} onChange={() => void p.onSetDefault(p.projectId, m.agentId)} /> По умолчанию</label>
      {m.sharedWithProject && <Config projectId={p.projectId} machine={m} readonly={!p.own} onSave={p.onSave} />}
    </td></tr>)}</tbody></table>}</section>
}
export function ProjectMachinesSettings(p: ProjectMachinesSettingsProps): JSX.Element {
  const own = new Map(p.machines.filter((m) => m.ownership === 'mine').map((m) => [m.agentId, m]))
  const mine = p.agents.map((a) => own.get(a.id) ?? ({ agentId: a.id, name: a.name, owner: 'вы', ownership: 'mine', online: a.online, sharedWithProject: false, isMyDefault: false, canUse: true, unavailableReason: null, load: 0, path: '', reposRoot: '', sshHost: '', sshUser: '' } satisfies ProjectMachine))
  const shared = p.machines.filter((m) => m.ownership === 'other' && m.sharedWithProject)
  return <div data-testid="project-machines-settings"><Table title="Мои машины" empty="Нет машин — добавьте машину в меню «Машины»." projectId={p.projectId} machines={mine} own onShare={p.onShare} onSave={p.onSave} onSetDefault={p.onSetDefault} />
    <Table title="Машины, предоставленные проекту" empty="Нет машин, предоставленных проекту." projectId={p.projectId} machines={shared} own={false} onShare={p.onShare} onSave={p.onSave} onSetDefault={p.onSetDefault} /></div>
}
