import { useEffect, useRef, useState } from 'react'
import type { GitAccessResult, GitAccessStatus } from '@shared/gitAccess'
import type { RendererApi } from '@shared/ipc'
import type { ProjectMachine } from '@shared/projects'
import { Button } from '@voicechat/ui-kit'

type Api = Pick<RendererApi, 'projects:gitAccessStatus' | 'projects:configureGitAccess' | 'projects:verifyGitAccess' | 'projects:deleteGitAccess' | 'projects:gitAccessDiagnostics'>
export function ProjectMachineGitAccess({ projectId, machine, repositoryUrl, owner, api }: { projectId: string; machine: ProjectMachine; repositoryUrl: string; owner: boolean; api: Api }): JSX.Element {
  const [status, setStatus] = useState<GitAccessStatus | null>(null)
  const [token, setToken] = useState('')
  const tokenRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const args = { id: projectId, agentId: machine.agentId, repositoryUrl }
  const apply = (result: GitAccessResult): void => { setStatus(result.status); setError(result.ok ? null : result.code) }
  const execute = async (operation: () => Promise<GitAccessResult>, clearSecret = false): Promise<void> => {
    setBusy(true); setError(null)
    try { apply(await operation()) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally {
      if (clearSecret) { setToken(''); if (tokenRef.current) tokenRef.current.value = '' }
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!repositoryUrl || machine.online !== true) { setStatus(null); return }
    void execute(() => api['projects:gitAccessStatus'](args))
  }, [projectId, machine.agentId, machine.online, repositoryUrl])
  if (!repositoryUrl) return <p className="proj-muted">Сначала задайте HTTPS URL GitHub-репозитория в общих настройках проекта.</p>
  if (machine.online !== true) return <p className="proj-offline">Машина offline. Секрет не будет принят или поставлен в очередь.</p>
  return <section className="proj-section" data-testid="project-machine-git-access">
    <p className="proj-field-label">Git-доступ · {machine.name ?? machine.agentId}</p>
    <p className="proj-hint">Используйте fine-grained GitHub PAT, ограниченный этим репозиторием, минимальными Contents permissions и коротким сроком действия.</p>
    <p>Статус: {status?.configured ? 'настроен' : 'не настроен'}{status?.account ? ` · аккаунт ${status.account}` : ''}{status?.checkedAt ? ` · проверено ${new Date(status.checkedAt).toLocaleString()}` : ''}</p>
    <p>Чтение: {status?.readAccess ?? 'unknown'} · Запись (dry-run): {status?.writeAccess ?? 'unknown'}</p>
    {status?.warnings.map((warning) => <p className="proj-offline" key={warning.effectiveUrl}>{warning.message}: {warning.originalUrl} → {warning.effectiveUrl}</p>)}
    {error && <p role="alert" className="proj-offline">{error}</p>}
    {owner && <label>Fine-grained GitHub PAT<input ref={tokenRef} className="login-input" type="password" autoComplete="new-password" disabled={busy} value={token} onChange={(event) => setToken(event.target.value)} /></label>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {owner && <Button disabled={busy || !token} onClick={() => void execute(() => api['projects:configureGitAccess']({ ...args, token }), true)}>{status?.configured ? 'Заменить credential' : 'Настроить credential'}</Button>}
      {owner && <Button disabled={busy || !status?.configured} onClick={() => void execute(() => api['projects:verifyGitAccess']({ ...args, refspec: 'refs/heads/main:refs/heads/main' }))}>Проверить чтение и запись</Button>}
      <Button disabled={busy} onClick={() => void execute(async () => { const result = await api['projects:gitAccessDiagnostics'](args); return result })}>Проверить insteadOf</Button>
      {owner && <Button variant="danger" disabled={busy || !status?.configured} onClick={() => void execute(() => api['projects:deleteGitAccess'](args))}>Удалить credential</Button>}
    </div>
  </section>
}
