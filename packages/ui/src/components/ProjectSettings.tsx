// Раздел «Настройки» страницы проекта (шапку и переключатель разделов рисует
// ProjectPage, здесь — только содержимое).
import { CiProjectDefaults } from './ci/CiProjectDefaults'
// Описание, git, технологии/навыки, workflow фич, участники, машины, удаление.
// Управляющие контролы (правка, участники, машины, удаление) — только владельцу.

import { useEffect, useState } from 'react'
import type { ProjectDetail, ProjectSummary, ProjectTestUser, WorkItemDefaultSkills, ProjectMachineDirectoryAssignments, ProjectMachineDirectoryKind } from '@shared/projects'
import type { KbContextMode } from '@shared/types'
import type { ManagedPreflightConfirmation } from '@shared/release'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { LlmEngineOption } from '@shared/admin'

import type { AgentInfo } from '@shared/agentProtocol'
import type { RendererApi } from '@shared/ipc'
import { Button } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { SettingsPage } from './SettingsPage'
import { ProjectMachinesSettings } from './ProjectMachinesSettings'
import { ProjectMachineGitAccess } from './ProjectMachineGitAccess'

import { DEFAULT_PROJECT_COMMAND_POLICY, type ProjectCommandPolicy } from '@shared/commandPolicy'
export interface ProjectSettingsProps {
  detail: ProjectDetail
  agents: AgentInfo[]
  currentUsername?: string
  llmAccess?: UserLlmAccess[]
  llmEngines?: LlmEngineOption[]
  onUpdate: (id: string, fields: { name?: string; description?: string; gitUrl?: string | null; previewUrl?: string | null; testUsers?: ProjectTestUser[]; technologies?: string[]; skills?: string[]; defaultSkills?: Partial<WorkItemDefaultSkills>; commitPolicy?: ProjectSummary['commitPolicy']; mergeTransport?: ProjectSummary['mergeTransport']; agentPlanApprovalMode?: ProjectSummary['agentPlanApprovalMode']; testCommand?: string; productionDeployCommand?: string; productionAgentId?: string | null; productionCheckoutPath?: string; productionHealthCheckCommand?: string; ciBaseBranch?: string; ciBranchTemplate?: string; ciReuseStrategy?: 'reuse' | 'clean' | 'fail'; ciExecAuthRef?: string; ciKbContextMode?: KbContextMode; doneRetentionDays?: number | null; commandPolicy?: ProjectCommandPolicy }) => void

  onDelete: (id: string) => void
  onAddMember: (id: string, username: string) => void
  onUpdateMemberRole: (id: string, username: string, role: 'owner' | 'member') => void
  onRemoveMember: (id: string, username: string) => void
  onLinkMachine: (id: string, agentId: string) => void | Promise<void>
  onUnlinkMachine: (id: string, agentId: string) => void | Promise<void>
  /** Уровень доступа предоставленной проекту машины (п.18). */
  onSetMachineShareAccess?: (id: string, agentId: string, access: 'full' | 'read') => void | Promise<void>
  onConfigureMachineStorage?: (id: string, agentId: string, storageId: string, directories?: ProjectMachineDirectoryAssignments) => void | Promise<void>
  onResetMachineDirectory?: (id: string, agentId: string, kind: ProjectMachineDirectoryKind) => void | Promise<void>
  onSetMachinePath: (id: string, agentId: string, path: string) => void | Promise<void>
  onSetReposRoot: (id: string, agentId: string, reposRoot: string) => void | Promise<void>
  onSetMachineSsh: (id: string, agentId: string, sshHost: string, sshUser: string) => void | Promise<void>
  onSetDefaultMachine: (id: string, agentId: string) => void | Promise<void>
  gitAccessApi?: Pick<RendererApi, 'projects:gitAccessStatus' | 'projects:configureGitAccess' | 'projects:verifyGitAccess' | 'projects:deleteGitAccess' | 'projects:gitAccessDiagnostics'>
  managedProductionApi?: Pick<RendererApi, 'releases:managedPreflight' | 'releases:managedConfirm' | 'projects:bootstrapProduction' | 'projects:get'>
  onManagedProductionConfirmed?: (detail: ProjectDetail) => void | Promise<void>
}

/** Редактор списка тегов (технологии/навыки). */
function TagEditor({ label, tags, editable, onChange }: {
  label: string
  tags: string[]
  editable: boolean
  onChange: (next: string[]) => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const t = draft.trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setDraft('')
  }
  return (
    <div className="proj-tags">
      <p className="proj-field-label">{label}</p>
      <div className="proj-chips">
        {tags.map((t) => (
          <span key={t} className="proj-chip">
            {t}
            {editable && (
              <button className="proj-chip-x" aria-label={`Убрать ${t}`} title="Убрать" onClick={() => onChange(tags.filter((x) => x !== t))}>
                ✕
              </button>
            )}
          </span>
        ))}
        {tags.length === 0 && <span className="proj-muted">—</span>}
      </div>
      {editable && (
        <input
          className="login-input"
          placeholder={`+ ${label.toLowerCase()}`}
          aria-label={`Добавить: ${label}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
      )}
    </div>
  )
}

/** Настройки проекта (ремоунтятся по ключу detail.id — сбрасывают черновики). */
export function ProjectSettings(props: ProjectSettingsProps): JSX.Element {
  const { detail, agents } = props
  const isOwner = detail.role === 'owner'
  const ownerCount = detail.members.filter((member) => member.role === 'owner').length
  const [name, setName] = useState(detail.name)
  const [description, setDescription] = useState(detail.description)
  const [gitUrl, setGitUrl] = useState(detail.gitUrl ?? '')
  const [previewUrl, setPreviewUrl] = useState(detail.previewUrl ?? '')
  useEffect(() => setPreviewUrl(detail.previewUrl ?? ''), [detail.previewUrl])
  // Тестовые учётки окружений: правки локальные, коммит по blur/удалению.
  const [testUsers, setTestUsers] = useState<ProjectTestUser[]>(detail.testUsers ?? [])
  useEffect(() => setTestUsers(detail.testUsers ?? []), [detail.testUsers])
  const commitTestUsers = (next: ProjectTestUser[]): void => {
    setTestUsers(next)
    props.onUpdate(detail.id, { testUsers: next.filter((user) => user.name.trim()) })
  }
  const patchTestUser = (index: number, patch: Partial<ProjectTestUser>): void => {
    setTestUsers((all) => all.map((user, i) => (i === index ? { ...user, ...patch } : user)))
  }
  const [newMember, setNewMember] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [activeTab, setActiveTab] = useState<'general' | 'llm' | 'board' | 'workflow' | 'members' | 'machines'>('general')
  const [selectedGitMachineId, setSelectedGitMachineId] = useState('')
  const [machineTab, setMachineTab] = useState<'settings' | 'git'>('settings')
  const [managedPreflight, setManagedPreflight] = useState<ManagedPreflightConfirmation | null>(null)
  const [managedProductionBusy, setManagedProductionBusy] = useState(false)
  const [managedProductionError, setManagedProductionError] = useState('')
  const runManagedPreflight = async (): Promise<void> => {
    if (!props.managedProductionApi) return
    setManagedProductionBusy(true); setManagedProductionError(''); setManagedPreflight(null)
    try { setManagedPreflight(await props.managedProductionApi['releases:managedPreflight']({ projectId: detail.id })) }
    catch (error) { setManagedProductionError(error instanceof Error ? error.message : String(error)) }
    finally { setManagedProductionBusy(false) }
  }
  const confirmManagedProduction = async (): Promise<void> => {
    if (!props.managedProductionApi || !managedPreflight) return
    setManagedProductionBusy(true); setManagedProductionError('')
    try {
      const updated = await props.managedProductionApi['releases:managedConfirm']({ projectId: detail.id, confirmationToken: managedPreflight.confirmationToken })
      setManagedPreflight(null)
      await props.onManagedProductionConfirmed?.(updated)
    } catch (error) { setManagedProductionError(error instanceof Error ? error.message : String(error)) }
    finally { setManagedProductionBusy(false) }
  }
  const [bootstrapBusy, setBootstrapBusy] = useState(false)
  const [bootstrapError, setBootstrapError] = useState('')
  const [bootstrapResult, setBootstrapResult] = useState<import('@shared/release').ProductionBootstrapResult | null>(null)
  // Bootstrap прод-машины: одним запросом storage/привязка/каталоги/команды/managed.
  const bootstrapProduction = async (): Promise<void> => {
    if (!props.managedProductionApi || !detail.productionAgentId) return
    setBootstrapBusy(true); setBootstrapError(''); setBootstrapResult(null)
    try {
      const result = await props.managedProductionApi['projects:bootstrapProduction']({ id: detail.id, agentId: detail.productionAgentId })
      setBootstrapResult(result)
      const updated = await props.managedProductionApi['projects:get']({ id: detail.id })
      if (updated) await props.onManagedProductionConfirmed?.(updated)
    } catch (error) { setBootstrapError(error instanceof Error ? error.message : String(error)) }
    finally { setBootstrapBusy(false) }
  }
  // Порог скрытия завершённых: черновик строкой — пустое поле это «не скрывать»
  // (null), а не 0. Синхронизируем с ответом сервера.
  const retentionOf = (v: number | null | undefined): string => (v == null ? '' : String(v))
  const [doneRetention, setDoneRetention] = useState(retentionOf(detail.doneRetentionDays))
  useEffect(() => {
    setDoneRetention(retentionOf(detail.doneRetentionDays))
  }, [detail.doneRetentionDays])
  const commitRetention = (): void => {
    const raw = doneRetention.trim()
    const parsed = raw === '' ? null : Number(raw)
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
      setDoneRetention(retentionOf(detail.doneRetentionDays))
      return
    }
    const next = parsed == null ? null : Math.floor(parsed)
    if (next !== (detail.doneRetentionDays ?? null)) props.onUpdate(detail.id, { doneRetentionDays: next })
  }

  const saveMeta = (): void => {
    props.onUpdate(detail.id, { name: name.trim() || detail.name, description, gitUrl: gitUrl.trim() || null })
  }
  const savePreviewUrl = (): void => {
    const raw = previewUrl.trim()
    if (!raw) { props.onUpdate(detail.id, { previewUrl: null }); return }
    try {
      const url = new URL(raw)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
      setPreviewUrl(url.toString())
      props.onUpdate(detail.id, { previewUrl: url.toString() })
    } catch { setPreviewUrl(detail.previewUrl ?? '') }
  }

  return (
    <div className="proj-detail" data-testid="project-settings">
      <SettingsPage
        ariaLabel="Разделы настроек проекта"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          { id: 'general', label: 'Общее' },
          { id: 'llm', label: 'LLM' },
          { id: 'board', label: 'Доска' },
          { id: 'workflow', label: 'Workflow и CI' },
          { id: 'members', label: 'Участники' },
          { id: 'machines', label: 'Машины' }
        ]}
      />
      {activeTab === 'general' && <>
      {isOwner ? (
        <div className="proj-meta-edit">
          <input className="login-input" aria-label="Название проекта" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveMeta} />
          <textarea className="login-input" aria-label="Описание" placeholder="Описание" value={description} onChange={(e) => setDescription(e.target.value)} onBlur={saveMeta} />
          <input className="login-input" aria-label="Git-репозиторий" placeholder="git@…" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} onBlur={saveMeta} />
          <input className="login-input" type="url" aria-label="URL веб-превью" placeholder="https://example.com" value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} onBlur={savePreviewUrl} onKeyDown={(e) => { if (e.key === 'Enter') savePreviewUrl() }} />
        </div>
      ) : (
        <div className="proj-meta-ro">
          <p>{detail.description || <span className="proj-muted">Без описания</span>}</p>
          {detail.gitUrl && <p className="proj-git">{detail.gitUrl}</p>}
        </div>
      )}

      <TagEditor label="Технологии" tags={detail.technologies} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { technologies: next })} />
      <TagEditor label="Навыки" tags={detail.skills} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { skills: next })} />

      <section className="proj-section" aria-label="Тестовые пользователи">
        <p className="proj-field-label">Тестовые пользователи</p>
        <p className="proj-hint">
          Учётные записи для входа в тестовые окружения проекта из Web Reader: модель получает их
          MCP-инструментом test-users и логинится в окружении сама. Не храните здесь production-пароли.
        </p>
        {testUsers.length === 0 && <p className="proj-muted">Тестовые пользователи не заведены</p>}
        <ul className="proj-test-users" role="list">
          {testUsers.map((user, index) => (
            <li key={index}>
              {isOwner ? <>
                <input className="login-input" aria-label={`Логин тестового пользователя ${index + 1}`} placeholder="Логин" value={user.name} onChange={(e) => patchTestUser(index, { name: e.target.value })} onBlur={() => commitTestUsers(testUsers)} />
                <input className="login-input" aria-label={`Пароль тестового пользователя ${index + 1}`} placeholder="Пароль" value={user.password} onChange={(e) => patchTestUser(index, { password: e.target.value })} onBlur={() => commitTestUsers(testUsers)} />
                <input className="login-input" aria-label={`Роль тестового пользователя ${index + 1}`} placeholder="Роль (admin, user…)" value={user.role ?? ''} onChange={(e) => patchTestUser(index, { role: e.target.value })} onBlur={() => commitTestUsers(testUsers)} />
                <input className="login-input" aria-label={`Заметка тестового пользователя ${index + 1}`} placeholder="Что доступно этой учётке" value={user.note ?? ''} onChange={(e) => patchTestUser(index, { note: e.target.value })} onBlur={() => commitTestUsers(testUsers)} />
                <IconButton aria-label={`Удалить тестового пользователя ${index + 1}`} title="Удалить" onClick={() => commitTestUsers(testUsers.filter((_, i) => i !== index))}>✕</IconButton>
              </> : <span>{user.name}{user.role ? ` — ${user.role}` : ''}{user.note ? ` (${user.note})` : ''}</span>}
            </li>
          ))}
        </ul>
        {isOwner && (
          <Button variant="secondary" onClick={() => setTestUsers([...testUsers, { name: '', password: '' }])}>
            + Добавить тестового пользователя
          </Button>
        )}
      </section>
      </>}

      {activeTab === 'board' && <>
      <div className="proj-section proj-default-skills">
        <p className="proj-field-label">Навыки по умолчанию</p>
        <p className="proj-hint">Автоматически добавляются в карточку при создании элемента соответствующего типа. В самой карточке их можно убрать или дополнить.</p>
        <TagEditor label="Эпики" tags={detail.defaultSkills.epic} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { defaultSkills: { epic: next } })} />
        <TagEditor label="Стори" tags={detail.defaultSkills.story} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { defaultSkills: { story: next } })} />
        <TagEditor label="Таски" tags={detail.defaultSkills.task} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { defaultSkills: { task: next } })} />
      </div>

      <div className="proj-section">
        <p className="proj-field-label">Доска</p>
        <p className="proj-hint">
          Завершённая задача пропадает с доски через указанное число дней после попадания в «Готово» — как в Jira. Из
          системы она не удаляется: открывается по прямой ссылке и переключателем «Показать завершённые» в шапке доски.
          Пусто — не скрывать никогда, 0 — убрать в конце того же дня (в «Готово» карточку переносит и CI-ран после
          успешного мержа, поэтому мгновенно она не исчезает).
        </p>
        <label>
          Скрывать завершённые через, дней
          <input
            className="login-input"
            type="number"
            min={0}
            step={1}
            disabled={!isOwner}
            aria-label="Скрывать завершённые через, дней"
            placeholder="не скрывать"
            value={doneRetention}
            onChange={(e) => setDoneRetention(e.target.value)}
            onBlur={commitRetention}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRetention()
            }}
          />
        </label>
      </div>
      </>}

      {activeTab === 'llm' && (
        <div className="proj-section">
          <p className="proj-field-label">LLM по умолчанию</p>
          <p className="proj-hint" data-testid="project-llm-hint">
            Пара применяется к чатам проекта сразу, а задачи получают её через наследование.
          </p>
          <CiProjectDefaults projectId={detail.id} editable={isOwner} llmAccess={props.llmAccess} llmEngines={props.llmEngines} section="llm" />
          <label>CI: база знаний в ране<select
            className="sel"
            aria-label="CI: база знаний в ране"
            disabled={!isOwner}
            value={detail.ciKbContextMode ?? 'auto'}
            onChange={(e) => props.onUpdate(detail.id, { ciKbContextMode: e.target.value as KbContextMode })}
          >
            <option value="auto">Контекст и инструменты (авто)</option>
            <option value="manual">Только инструменты (по запросу модели)</option>
            <option value="off">Выключена</option>
          </select></label>
          <p className="proj-muted" data-testid="proj-ci-kb-hint">
            Режим влияет на работу модели в CI-ране: в «авто» сервер подмешивает разделы базы знаний
            по теме задачи и выдаёт модели инструменты mcp__kb__*, в «по запросу» — только инструменты.
            На чаты проекта настройка не влияет — у каждого чата свой режим. Значение применяется
            к следующему рану.
          </p>
        </div>
      )}

      {activeTab === 'workflow' && <div className="proj-section feature-policy">
        <p className="proj-field-label">Workflow фич</p>
        {(() => { const cp = detail.commandPolicy ?? DEFAULT_PROJECT_COMMAND_POLICY; return (
        <fieldset className="pset-cmdpolicy" data-testid="project-command-policy">
          <legend>Команды на машинах проекта</legend>
          <label>Запрещённые паттерны (по одному в строке)
            <textarea className="sel" rows={2} disabled={!isOwner} aria-label="Запрещённые паттерны команд проекта" defaultValue={cp.denyPatterns.join('\n')} placeholder={'rm\\s+-rf\ndocker system prune'} onBlur={(e) => props.onUpdate(detail.id, { commandPolicy: { ...cp, denyPatterns: e.target.value.split('\n').map((v) => v.trim()).filter(Boolean) } })} />
          </label>
          <label>Разрешённые паттерны (если заданы — только они)
            <textarea className="sel" rows={2} disabled={!isOwner} aria-label="Разрешённые паттерны команд проекта" defaultValue={cp.allowPatterns.join('\n')} placeholder={'^git \n^npm '} onBlur={(e) => props.onUpdate(detail.id, { commandPolicy: { ...cp, allowPatterns: e.target.value.split('\n').map((v) => v.trim()).filter(Boolean) } })} />
          </label>
          <label className="pset-check"><input type="checkbox" disabled={!isOwner} aria-label="Подтверждать опасные команды в чате" checked={cp.confirmDangerous} onChange={(e) => props.onUpdate(detail.id, { commandPolicy: { ...cp, confirmDangerous: e.target.checked } })} /> Опасные команды (rm -rf, force-push, DROP …) модель выполняет только после подтверждения в чате</label>
        </fieldset>) })()}
        <label>Коммиты<select className="sel" disabled={!isOwner} value={detail.commitPolicy} onChange={(e) => props.onUpdate(detail.id, { commitPolicy: e.target.value as ProjectSummary['commitPolicy'] })}><option value="agent_commits">Агент создаёт коммиты</option><option value="final_system_commit">Итоговый системный коммит</option><option value="manual_user_confirmation">Подтверждать коммит</option></select></label>
        <label>Merge<select className="sel" disabled={!isOwner} value={detail.mergeTransport} onChange={(e) => props.onUpdate(detail.id, { mergeTransport: e.target.value as ProjectSummary['mergeTransport'] })}><option value="local">Локальный merge commit</option><option value="github_pull_request">GitHub Pull Request</option></select></label>
        <label>План агента<select className="sel" disabled={!isOwner} value={detail.agentPlanApprovalMode} onChange={(e) => props.onUpdate(detail.id, { agentPlanApprovalMode: e.target.value as ProjectSummary['agentPlanApprovalMode'] })}><option value="manual">Подтверждать</option><option value="automatic">Запускать автоматически</option></select></label>
        <label>Команда тестирования<input className="login-input" disabled={!isOwner} value={detail.testCommand ?? ''} onChange={(e) => props.onUpdate(detail.id, { testCommand: e.target.value })} placeholder="npm test" /></label>
        <p className="proj-field-label" data-testid="production-environment-mode">Режим production: {detail.productionEnvironmentMode==='managed'?'Managed MachineStorage':'Legacy compatibility'}</p>
        {detail.productionEnvironmentMode!=='managed'&&<>
          <p className="proj-muted">Legacy checkout не управляется MachineStorage и сохраняется неизменным при переходе.</p>
          {isOwner&&props.managedProductionApi&&<div className="proj-managed-production" data-testid="managed-production-transition">
            <Button type="button" variant="secondary" disabled={managedProductionBusy} onClick={() => void runManagedPreflight()}>{managedProductionBusy?'Проверка…':'Проверить Managed production'}</Button>
            {managedProductionError&&<p role="alert" className="proj-error">{managedProductionError}</p>}
            {managedPreflight&&<div className="proj-managed-preflight">
              <p role="status">Preflight пройден. Checkout: {managedPreflight.paths.repository}</p>
              <ul>{Object.entries(managedPreflight.checks).map(([name,check])=><li key={name}>{name}: {check.ok?'готово':check.message}</li>)}</ul>
              <p className="proj-muted">Переход необратимо отключит legacy checkout. Deploy автоматически не запустится.</p>
              <Button type="button" variant="primary" disabled={managedProductionBusy} onClick={() => void confirmManagedProduction()}>Подтвердить переход в Managed</Button>
            </div>}
          </div>}
        </>}
        <label>Production-машина<select className="sel" disabled={!isOwner} value={detail.productionAgentId ?? ''} onChange={(e) => props.onUpdate(detail.id, { productionAgentId: e.target.value || null })}><option value="">Не настроена</option>{detail.machines.map(machine=><option key={machine.agentId} value={machine.agentId}>{machine.name ?? machine.agentId}{machine.online===false?' · offline':''}</option>)}</select></label>
        {isOwner&&props.managedProductionApi&&detail.productionAgentId&&<div className="proj-managed-production" data-testid="production-bootstrap">
          <Button type="button" variant="secondary" disabled={bootstrapBusy} onClick={() => void bootstrapProduction()}>{bootstrapBusy?'Подготовка…':'Подготовить прод-машину'}</Button>
          <p className="proj-muted">Создаст хранилище-привязку и каталоги, проставит deploy/health-команды, при необходимости назначит машину для CI/merge и включит Managed. Останется только войти в CLI (`claude login`/`codex login`) на машине.</p>
          {bootstrapError&&<p role="alert" className="proj-error">{bootstrapError}</p>}
          {bootstrapResult&&<div className="proj-managed-preflight" role="status">
            <p>{bootstrapResult.ok?'Готово: Managed production включён.':'Подготовка выполнена, но Managed не включён — проверьте пункты ниже.'}{bootstrapResult.defaultMachineSet?' Машина назначена для CI/merge/тасков.':''}</p>
            <ul>{Object.entries(bootstrapResult.preflight.checks).map(([name,check])=><li key={name}>{name}: {check.ok?'готово':check.message}</li>)}</ul>
            <p className="proj-muted">{bootstrapResult.cliLoginHint}</p>
          </div>}
        </div>}
        <label>Production checkout<input className="login-input" disabled={!isOwner||detail.productionEnvironmentMode==='managed'} value={detail.productionCheckoutPath ?? ''} onChange={(e) => props.onUpdate(detail.id, { productionCheckoutPath: e.target.value })} placeholder="/root/voiceAIChat" /></label>
        <label>Штатная команда production-деплоя<input className="login-input" disabled={!isOwner} value={detail.productionDeployCommand ?? ''} onChange={(e) => props.onUpdate(detail.id, { productionDeployCommand: e.target.value })} placeholder="voicechat-deploy" /></label>
        <label>Команда health-check<input className="login-input" disabled={!isOwner} value={detail.productionHealthCheckCommand ?? ''} onChange={(e) => props.onUpdate(detail.id, { productionHealthCheckCommand: e.target.value })} placeholder="curl -fsS http://127.0.0.1:8787/api/health" /></label>
        <label>CI: базовая ветка<input className="login-input" disabled={!isOwner} value={detail.ciBaseBranch ?? ''} onChange={(e) => props.onUpdate(detail.id, { ciBaseBranch: e.target.value })} placeholder="main" /></label>
        <label>CI: шаблон ветки<input className="login-input" disabled={!isOwner} value={detail.ciBranchTemplate ?? ''} onChange={(e) => props.onUpdate(detail.id, { ciBranchTemplate: e.target.value })} placeholder="{task_number}" /></label>
        <label>CI: повтор директории<select className="sel" disabled={!isOwner} value={detail.ciReuseStrategy ?? 'fail'} onChange={(e) => props.onUpdate(detail.id, { ciReuseStrategy: e.target.value as 'reuse' | 'clean' | 'fail' })}><option value="fail">Упасть, если существует</option><option value="reuse">Переиспользовать</option><option value="clean">Очистить и заново</option></select></label>
        <div className="ci-defaults-wrap"><div className="convsettings-caption">Команды воркфлоу по умолчанию</div><CiProjectDefaults projectId={detail.id} editable={isOwner} section="commands" /></div>
      </div>}

      {activeTab === 'members' && <div className="proj-section">
        <p className="proj-field-label">Участники</p>
        <ul className="proj-members">
          {detail.members.map((m) => {
            const lastOwner = m.role === 'owner' && ownerCount === 1
            const current = m.username === props.currentUsername
            return (
              <li key={m.username}>
                <span>
                  {m.username}{current && <span className="proj-muted"> · вы</span>}
                  {m.username === detail.createdBy && <span className="proj-muted"> · создатель</span>}
                  {m.addedAt > 0 && (
                    <time className="proj-muted" dateTime={new Date(m.addedAt).toISOString()}>
                      {' · с ' + new Date(m.addedAt).toLocaleDateString()}
                    </time>
                  )}
                </span>
                <span>
                  {isOwner ? (
                    <select
                      className="sel"
                      aria-label={`Роль ${m.username}`}
                      value={m.role}
                      disabled={lastOwner}
                      title={lastOwner ? 'Сначала назначьте другого владельца' : undefined}
                      onChange={(event) => {
                        const role = event.target.value as 'owner' | 'member'
                        if (role === 'owner' && !window.confirm(
                          'Назначить владельцем? Пользователь получит полный доступ к настройкам, участникам, машинам, CI и релизам.'
                        )) return
                        props.onUpdateMemberRole(detail.id, m.username, role)
                      }}
                    >
                      <option value="owner">Владелец</option>
                      <option value="member">Участник</option>
                    </select>
                  ) : (
                    <span className="proj-muted">{m.role === 'owner' ? 'Владелец' : 'Участник'}</span>
                  )}
                  {isOwner && (
                    <IconButton
                      size="sm"
                      className="vc-btn--danger-quiet"
                      aria-label={`Убрать ${m.username}`}
                      title={lastOwner ? 'Сначала назначьте другого владельца' : 'Убрать участника'}
                      disabled={lastOwner}
                      onClick={() => {
                        if (m.role === 'owner' && !window.confirm(`Удалить владельца ${m.username} из проекта?`)) return
                        props.onRemoveMember(detail.id, m.username)
                      }}
                    >
                      ✕
                    </IconButton>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
        {isOwner && ownerCount === 1 && (
          <p className="proj-muted">Последнего владельца нельзя понизить, удалить или вывести из проекта. Сначала назначьте другого владельца.</p>
        )}
        {isOwner && (
          <div className="proj-add-member">
            <input
              className="login-input"
              placeholder="Логин участника"
              aria-label="Добавить участника"
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newMember.trim()) {
                  props.onAddMember(detail.id, newMember.trim())
                  setNewMember('')
                }
              }}
            />
          </div>
        )}
      </div>}

      {activeTab === 'machines' && <><div className="proj-section"><label>Связка проекта и машины<select className="sel" aria-label="Машина для Git-доступа" value={selectedGitMachineId} onChange={(event) => { setSelectedGitMachineId(event.target.value); setMachineTab('settings') }}><option value="">Выберите машину</option>{detail.machines.filter((machine) => machine.sharedWithProject || machine.ownership === 'mine').map((machine) => <option key={machine.agentId} value={machine.agentId}>{machine.name ?? machine.agentId}</option>)}</select></label>{selectedGitMachineId && <div role="tablist" aria-label="Настройки связки"><Button size="sm" onClick={() => setMachineTab('settings')}>Настройки</Button><Button size="sm" onClick={() => setMachineTab('git')}>Git-доступ</Button></div>}</div>{machineTab === 'settings' && <ProjectMachinesSettings
        projectId={detail.id}
        machines={detail.machines}
        agents={agents}
        onShare={(id, agentId, shared) => shared ? props.onLinkMachine(id, agentId) : props.onUnlinkMachine(id, agentId)}
        {...(props.onSetMachineShareAccess ? { onSetShareAccess: props.onSetMachineShareAccess } : {})}
        onSave={(id, agentId, field, value, machine) => {
          if (field === 'sshHost' || field === 'sshUser') return props.onSetMachineSsh(id, agentId, field === 'sshHost' ? value : machine.sshHost ?? '', field === 'sshUser' ? value : machine.sshUser ?? '')
          const directoryKind = field === 'path' ? 'projectWorkdir' : field
          if (!machine.storageId || !machine.directories) return directoryKind === 'projectWorkdir' ? props.onSetMachinePath(id, agentId, value) : directoryKind === 'reposRoot' ? props.onSetReposRoot(id, agentId, value) : undefined
          const directories = structuredClone(machine.directories)
          directories[directoryKind] = { path: value, override: true }
          return props.onConfigureMachineStorage?.(id, agentId, machine.storageId, directories)
        }}
        onSetDefault={props.onSetDefaultMachine}
        onConfigureStorage={props.onConfigureMachineStorage}
        onResetDirectory={props.onResetMachineDirectory}
      />}{machineTab === 'git' && selectedGitMachineId && props.gitAccessApi && <ProjectMachineGitAccess projectId={detail.id} machine={detail.machines.find((machine) => machine.agentId === selectedGitMachineId)!} repositoryUrl={detail.gitUrl ?? ''} owner={isOwner} api={props.gitAccessApi} />}</>}

      {activeTab === 'general' && isOwner && (
        <div className="proj-danger">
          {confirmDel ? (
            <span className="delconfirm">
              <span>Удалить проект?</span>
              <Button variant="danger" size="sm" onClick={() => props.onDelete(detail.id)}>
                Удалить
              </Button>
              <Button size="sm" onClick={() => setConfirmDel(false)}>
                Отмена
              </Button>
            </span>
          ) : (
            <Button variant="danger" size="sm" className="proj-delete" onClick={() => setConfirmDel(true)}>
              Удалить проект
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
