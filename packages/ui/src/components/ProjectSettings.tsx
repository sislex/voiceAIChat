// Раздел «Настройки» страницы проекта (шапку и переключатель разделов рисует
// ProjectPage, здесь — только содержимое).
import { CiProjectDefaults } from './ci/CiProjectDefaults'
import type { ProjectSettingsTab } from '@voicechat/projects-app'
import { AutomatedQaScenarioEditor } from './AutomatedQaScenarioEditor'
import type { AutomatedQaMode, AutomatedQaScenario } from '@shared/qa'
import { formatDate, isoDate } from '../lib/dateFormat'
// Описание, git, технологии/навыки, workflow фич, участники, машины, удаление.
// Управляющие контролы (правка, участники, машины, удаление) — только владельцу.

import { useEffect, useRef, useState } from 'react'
import { highlightCode } from '@voicechat/ui-foundation/lib/codeHighlight'
import type { ProjectDetail, ProjectInvitation, ProjectRole, ProjectSummary, ProjectTestUser, WorkItemDefaultSkills, ProjectMachineDirectoryAssignments, ProjectMachineDirectoryKind } from '@shared/projects'
import type { KbContextMode } from '@shared/types'
import type { ManagedPreflightConfirmation } from '@shared/release'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { LlmEngineOption } from '@shared/admin'

import type { AgentInfo } from '@shared/agentProtocol'
import type { RendererApi } from '@shared/ipc'
import { Button, StickyActionBar } from '@voicechat/ui-kit'
import { IconButton, useConfirm } from '@voicechat/ui-kit'
import { SettingsPage } from './SettingsPage'
import { ProjectMachinesSettings } from './ProjectMachinesSettings'
import { ProjectMachineGitAccess } from './ProjectMachineGitAccess'

import { DEFAULT_PROJECT_COMMAND_POLICY, type ProjectCommandPolicy } from '@shared/commandPolicy'
import { ALL_PROJECT_FEATURES, PROJECT_FEATURE_LABELS, PROJECT_FEATURES, projectTypeChainLabel, resolveProjectTypeFeatures, type ProjectTypeNode } from '@shared/projectTypes'
export interface ProjectSettingsProps {
  detail: ProjectDetail
  /**
   * Активная вкладка из адреса (`/projects/:id/settings/:tab`). Без неё компонент
   * хранит вкладку сам — так живут сториз и тесты без роутера.
   */
  activeTab?: ProjectSettingsTab
  /**
   * Смена вкладки — хост пишет её в адрес. `replace` — когда вкладку меняем не
   * по клику, а потому что её отключил тип проекта: иначе «Назад» упирается в редирект.
   */
  onTabChange?: (tab: ProjectSettingsTab, opts?: { replace?: boolean }) => void
  /** Каталог типов для селекта; пусто — селект не показываем. */
  projectTypes?: ProjectTypeNode[]
  /** «Сохранить проект как подтип»; нет обработчика — кнопки нет. */
  onDeriveType?: (id: string, name: string) => void | Promise<void>
  ciCommands?: import('@shared/ci').CiCommand[]
  onLoadCommands?: () => void | Promise<void>
  onCheckTestLogin?: (projectId: string, username: string) => Promise<void>
  agents: AgentInfo[]
  currentUsername?: string
  llmAccess?: UserLlmAccess[]
  llmEngines?: LlmEngineOption[]
  /** Разовый прогон набора сценариев Automated QA — приходит из хоста. */
  checkAutomatedQa?: (id: string, scenarioIndex?: number) => Promise<import('@shared/qa').AutomatedQaCheckResult[]>
  onUpdate: (id: string, fields: { typeId?: string; name?: string; description?: string; gitUrl?: string | null; previewUrl?: string | null; testUsers?: ProjectTestUser[]; technologies?: string[]; skills?: string[]; defaultSkills?: Partial<WorkItemDefaultSkills>; commitPolicy?: ProjectSummary['commitPolicy']; mergeTransport?: ProjectSummary['mergeTransport']; agentPlanApprovalMode?: ProjectSummary['agentPlanApprovalMode']; testCommand?: string; componentQaCommand?: string; integrationTestCommand?: string; automatedQaCommand?: string; automatedQaMode?: AutomatedQaMode; automatedQaScenarios?: AutomatedQaScenario[]; autoPilotDefault?: boolean; autoPilotRequiresManualQa?: boolean; autoPilotFixLimit?: number; productionDeployCommand?: string; productionAgentId?: string | null; productionCheckoutPath?: string; productionHealthCheckCommand?: string; ciBaseBranch?: string; ciBranchTemplate?: string; ciReuseStrategy?: 'reuse' | 'clean' | 'fail'; ciExecAuthRef?: string; ciKbContextMode?: KbContextMode; doneRetentionDays?: number | null; commandPolicy?: ProjectCommandPolicy }) => void | Promise<void>

  onDelete: (id: string) => void
  // onAddMember убран намеренно: участник добавляется только приглашением, а
  // молчаливое добавление осталось REST-роутом для админских сценариев и тестов.
  /** Живые приглашения проекта (владельцу). */
  invitations?: ProjectInvitation[]
  /** Пригласить по логину или email; нет обработчика — блок не показываем. */
  onInvite?: (id: string, invitee: string, role: ProjectRole, ttlDays?: number) => void | Promise<void>
  onResendInvitation?: (id: string, invitationId: string) => void | Promise<void>
  onRevokeInvitation?: (id: string, invitationId: string) => void | Promise<void>
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

/** Эффективные возможности узла с учётом цепочки родителей. */
function effectiveFeatures(node: ProjectTypeNode, all: ProjectTypeNode[]): ReturnType<typeof resolveProjectTypeFeatures> {
  const chain: ProjectTypeNode[] = []
  let current: ProjectTypeNode | undefined = node
  while (current) {
    chain.unshift(current)
    current = current.parentId ? all.find((t) => t.id === current!.parentId) : undefined
  }
  return resolveProjectTypeFeatures(chain)
}

/** Подпись опции — путь от корня: одноимённые подтипы иначе не различить. */
function typeOptionLabel(type: ProjectTypeNode, all: ProjectTypeNode[]): string {
  const chain: ProjectTypeNode[] = []
  let current: ProjectTypeNode | undefined = type
  while (current) {
    chain.unshift(current)
    current = current.parentId ? all.find((t) => t.id === current!.parentId) : undefined
  }
  return projectTypeChainLabel(chain)
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
function shellQuote(value: string): string { return "'" + value.replace(/'/g, "'\\''") + "'" }

function ProductionCheck({ detail, api, disabled }: { detail: ProjectDetail; api: ProjectSettingsProps['managedProductionApi']; disabled: boolean }): JSX.Element {
  const [checks, setChecks] = useState<Array<{ name: string; ok: boolean; message: string }>>([])
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const run = async (): Promise<void> => {
    if (busy || disabled) return
    setBusy(true); setChecks([])
    const abort = new AbortController()
    controller.current = abort
    const results: Array<{ name: string; ok: boolean; message: string }> = []
    const add = (name: string, ok: boolean, message: string): void => { results.push({ name, ok, message }); setChecks([...results]) }
    try {
      if (!window.fs) throw new Error('Мост машины недоступен')
      const machine = detail.machines.find(machine => machine.agentId === detail.productionAgentId)
      if (!machine?.online) { add('Машина', false, 'Выберите доступную production-машину и подключите её.'); return }
      add('Машина', true, machine.name ?? machine.agentId)
      let path = detail.productionCheckoutPath ?? ''
      if (detail.productionEnvironmentMode === 'managed') {
        if (!api) { add('Checkout', false, 'Managed preflight недоступен. Обновите страницу.'); return }
        try {
          const preflight = await api['releases:managedPreflight']({ projectId: detail.id })
          path = preflight.paths.repository
          Object.entries(preflight.checks).forEach(([name, check]) => add(name, check.ok, check.message))
        } catch (error) { add('Checkout', false, String(error) + ' Проверьте MachineStorage, origin и чистоту checkout.'); return }
      } else if (!path || !detail.gitUrl) {
        add('Checkout', false, 'Укажите production checkout и Git URL.'); return
      } else {
        const checkout = await window.fs.exec(machine.agentId, 'cd ' + shellQuote(path) + ' && git rev-parse --is-inside-work-tree && test "$(git remote get-url origin)" = ' + shellQuote(detail.gitUrl) + ' && test -z "$(git status --porcelain)"', abort.signal, detail.id)
        add('Checkout', checkout.exitCode === 0 && !checkout.timedOut, checkout.exitCode === 0 ? path : 'Проверьте каталог, origin и незакоммиченные изменения. ' + checkout.output.slice(0, 2000))
      }
      if (!detail.productionHealthCheckCommand?.trim()) { add('Health-check', false, 'Задайте команду health-check.'); return }
      const health = await window.fs.exec(machine.agentId, 'cd ' + shellQuote(path) + ' && (\n' + detail.productionHealthCheckCommand + '\n)', abort.signal, detail.id)
      add('Health-check', health.exitCode === 0 && !health.timedOut, health.exitCode === 0 ? 'Production отвечает.' : 'Проверьте сервис и health-check команду. ' + health.output.slice(0, 2000))
    } catch (error) { add('Проверка', false, (error instanceof Error ? error.message : String(error)) + ' Проверьте доступ к машине.') }
    finally { setBusy(false) }
  }
  return <section className="proj-section" aria-label="Проверка production">
    <Button disabled={disabled || busy} loading={busy} onClick={() => void run()}>Проверить production</Button>
    {disabled && <p className="proj-hint">Сохраните или отмените изменения перед проверкой.</p>}
    <ul aria-live="polite">{checks.map(check => <li key={check.name} className={check.ok ? 'project-check-ok' : 'proj-error'}>{check.ok ? '✓' : '✕'} {check.name}: {check.message}</li>)}</ul>
  </section>
}

function ProjectCommandCheck({ project, command, label }: { project: ProjectDetail; command: string; label: string }): JSX.Element {
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const machine = project.machines.find(machine => machine.agentId === project.defaultAgentId)
  const run = async (): Promise<void> => {
    if (!machine || !command.trim() || busy) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true); setOutput('')
    try {
      if (!window.fs) throw new Error('Мост машины недоступен')
      const result = await window.fs.exec(machine.agentId, 'cd ' + shellQuote(machine.path) + ' && (\n' + command + '\n)', abort.signal, project.id)
      setOutput('Код выхода: ' + result.exitCode + (result.timedOut ? ' · Превышен лимит времени' : '') + '\n' + result.output.split(/\r?\n/).slice(0, 50).join('\n'))
    } catch (error) { setOutput(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <div className="project-command-check">
    {command && <pre aria-hidden="true"><code dangerouslySetInnerHTML={{ __html: highlightCode(command, 'command.sh') }} /></pre>}
    <Button size="sm" disabled={!command.trim() || !machine?.online || !machine.path || busy || project.role !== 'owner'} onClick={() => void run()} aria-label={'Проверить на машине: ' + label}>Проверить на машине</Button>
    {busy && <Button size="sm" onClick={() => controller.current?.abort()}>Остановить</Button>}
    <p className="proj-hint">{machine ? 'Машина: ' + (machine.name ?? machine.agentId) + ' · ' + machine.path : 'Назначьте машину проекта по умолчанию.'} Вывод ограничен первыми 50 строками.</p>
    {output && <pre role="status">{output}</pre>}
  </div>
}

type SettingsPatch = Parameters<ProjectSettingsProps['onUpdate']>[1]

export function projectFieldError(field: string, value: string): string {
  if (field === 'gitUrl') {
    if (!value) return ''
    if (/^[^\s@]+@[^\s:]+:[^\s]+$/.test(value)) return ''
    try {
      const url = new URL(value)
      if (['https:', 'ssh:'].includes(url.protocol) && url.hostname && url.pathname.length > 1 && !/\s/.test(value)) return ''
    } catch { /* Show the same actionable message for malformed URLs. */ }
    return 'Введите HTTPS или SSH URL репозитория, например git@github.com:team/repo.git.'
  }
  if (field === 'previewUrl') {
    if (!value) return ''
    try { if (['http:', 'https:'].includes(new URL(value).protocol)) return '' } catch { /* Invalid URL. */ }
    return 'Введите абсолютный http/https адрес.'
  }
  if (field === 'ciBranchTemplate' || field === 'ciBaseBranch') {
    if (!value.trim()) return 'Укажите ветку.'
    let branch = value
    if (field === 'ciBranchTemplate') {
      branch = value.replace('{task_number}', 'CHAT-123').replace('{slug}', 'task-title')
      if (/[{}]/.test(branch)) return 'Допустимые подстановки: {task_number} и {slug}, каждая один раз.'
    }
    if (/[\s~^:?*\[\\]/.test(branch) || branch.includes('..') || branch.includes('@{') || branch.startsWith('-') || branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock') || part.endsWith('.'))) return 'Имя ветки не должно содержать пробелы или недопустимые Git-символы.'
  }
  if (field.endsWith('Command') && !value.trim()) return 'Введите непустую команду.'
  if (field === 'name' && !value.trim()) return 'Введите название проекта.'
  return ''
}

export function ProjectSettings(props: ProjectSettingsProps): JSX.Element {
  return <ProjectSettingsDraft key={props.detail.id} {...props} />
}

function ProjectSettingsDraft(props: ProjectSettingsProps): JSX.Element {
  const [patch, setPatch] = useState<SettingsPatch>({})
  const confirm = useConfirm()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirty = Object.keys(patch).length > 0
  const errors = Object.fromEntries(Object.entries(patch).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, projectFieldError(key, String(value))]))
  const invalid = Object.values(errors).some(Boolean)
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = '' }
    const navigate = (event: Event): void => {
      const { target, resume } = (event as CustomEvent<{ target: string; resume: () => void }>).detail
      const settings = '#/projects/' + props.detail.id + '/settings'
      if (target === settings || target.startsWith(settings + '/')) return
      event.preventDefault()
      void confirm({ title: 'Уйти без сохранения?', message: 'Несохранённые изменения настроек будут потеряны.', confirmLabel: 'Уйти' }).then(ok => {
        if (ok) { setPatch({}); resume() }
      })
    }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('voicechat:before-navigate', navigate)
    return () => {
      window.removeEventListener('beforeunload', warn)
      window.removeEventListener('voicechat:before-navigate', navigate)
    }
  }, [dirty, props.detail.id, confirm])
  const update: ProjectSettingsProps['onUpdate'] = (_id, fields) => {
    setPatch(current => {
      const next = { ...current, ...fields }
      if (fields.defaultSkills) next.defaultSkills = { ...props.detail.defaultSkills, ...current.defaultSkills, ...fields.defaultSkills }
      for (const key of Object.keys(next) as Array<keyof SettingsPatch>) {
        if (JSON.stringify(next[key]) === JSON.stringify(props.detail[key])) delete next[key]
      }
      return next
    })
  }
  const save = async (): Promise<void> => {
    if (saving || invalid || !dirty) return
    setSaving(true); setError('')
    try { await props.onUpdate(props.detail.id, patch); setPatch({}) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }
  const detail = { ...props.detail, ...patch, defaultSkills: { ...props.detail.defaultSkills, ...patch.defaultSkills } }
  return <div className="project-settings-form">
    <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <ProjectSettingsForm {...props} detail={detail} onUpdate={update} unsaved={dirty} errors={errors} />
    </fieldset>
    {error && <p role="alert" className="proj-error">{error}</p>}
    <StickyActionBar open={dirty} title="Есть несохранённые изменения" hint={invalid ? 'Исправьте ошибки в полях перед сохранением.' : undefined}>
      <Button variant="primary" disabled={invalid || saving} loading={saving} onClick={() => void save()}>Сохранить</Button>
      <Button disabled={saving} onClick={() => { setPatch({}); setError('') }}>Отменить</Button>
    </StickyActionBar>
  </div>
}

function ProjectSettingsForm(props: ProjectSettingsProps & { unsaved: boolean; errors: Record<string, string> }): JSX.Element {
  const { detail, agents } = props
  const isOwner = detail.role === 'owner'
  const ownerCount = detail.members.filter((member) => member.role === 'owner').length
  const name = detail.name
  const description = detail.description
  const gitUrl = detail.gitUrl ?? ''
  const previewUrl = detail.previewUrl ?? ''
  const setName = (name: string): void => { props.onUpdate(detail.id, { name }) }
  const setDescription = (description: string): void => { props.onUpdate(detail.id, { description }) }
  const setGitUrl = (gitUrl: string): void => { props.onUpdate(detail.id, { gitUrl: gitUrl || null }) }
  const setPreviewUrl = (previewUrl: string): void => { props.onUpdate(detail.id, { previewUrl: previewUrl || null }) }
  // Тестовые учётки окружений: правки локальные, коммит по blur/удалению.
  const testUsers = detail.testUsers ?? []
  const setTestUsers = (testUsers: ProjectTestUser[]): void => { props.onUpdate(detail.id, { testUsers }) }
  const commitTestUsers = setTestUsers
  const patchTestUser = (index: number, patch: Partial<ProjectTestUser>): void => {
    setTestUsers(testUsers.map((user, i) => (i === index ? { ...user, ...patch } : user)))
  }
  const [newMember, setNewMember] = useState('')
  const [inviteTtl, setInviteTtl] = useState(7)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState('')
  const checkLogin = async (username: string): Promise<void> => {
    if (!props.onCheckTestLogin || loginBusy) return
    setLoginBusy(true); setLoginError('')
    try { await props.onCheckTestLogin(detail.id, username) }
    catch (error) { setLoginError(error instanceof Error ? error.message : String(error)) }
    finally { setLoginBusy(false) }
  }
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const submitInvite = async (): Promise<void> => {
    const invitee = newMember.trim()
    if (!invitee || !props.onInvite || inviting) return
    setInviting(true); setInviteError('')
    try { await props.onInvite(detail.id, invitee, inviteRole, inviteTtl); setNewMember('') }
    catch (error) { setInviteError(error instanceof Error ? error.message : String(error)) }
    finally { setInviting(false) }
  }
  const [confirmDel, setConfirmDel] = useState(false)
  const [localTab, setLocalTab] = useState<ProjectSettingsTab>('general')
  const activeTab = props.activeTab ?? localTab
  useEffect(() => { if (activeTab === 'workflow') void props.onLoadCommands?.() }, [activeTab])
  const setActiveTab = (tab: ProjectSettingsTab, opts?: { replace?: boolean }): void => {
    if (props.activeTab === undefined) setLocalTab(tab)
    props.onTabChange?.(tab, opts)
  }
  const confirm = useConfirm()
  const [inviteRole, setInviteRole] = useState<ProjectRole>('member')
  const [deriveOpen, setDeriveOpen] = useState(false)
  const [deriveName, setDeriveName] = useState('')
  /**
   * Смена типа. Если новый тип что-то выключает, спрашиваем: сузить набор —
   * значит убрать со страницы целые разделы, и молчаливое переключение
   * выглядит как поломка.
   */
  const changeType = async (typeId: string): Promise<void> => {
    if (typeId === detail.typeId) return
    const next = props.projectTypes?.find((t) => t.id === typeId)
    const lost = next
      ? PROJECT_FEATURES.filter((feature) => features[feature] && !effectiveFeatures(next, props.projectTypes ?? [])[feature])
      : []
    if (next) {
      const ok = await confirm({
        title: 'Сменить тип проекта?',
        message: `Включатся: ${PROJECT_FEATURES.filter(feature => !features[feature] && effectiveFeatures(next, props.projectTypes ?? [])[feature]).map(feature => PROJECT_FEATURE_LABELS[feature]).join(', ') || 'без изменений'}. Станут недоступны: ${lost.map(feature => PROJECT_FEATURE_LABELS[feature]).join(', ') || 'без изменений'}. Вкладки карточки: ${lost.flatMap(feature => feature === 'git' ? ['Код', 'Merge'] : feature === 'ci' ? ['Подготовка к разработке', 'Улучшения', 'Лента рана'] : feature === 'qa' ? ['Component QA', 'Интеграционные тесты', 'Automated QA', 'Ручное QA'] : []).join(', ') || 'сохраняются'}. Данные не удаляются. Изменения применятся после сохранения.`,
        confirmLabel: 'Сменить тип'
      })
      if (!ok) return
    }
    props.onUpdate(detail.id, { typeId })
  }

  const submitDerive = (): void => {
    const name = deriveName.trim()
    if (!name || !props.onDeriveType) return
    void props.onDeriveType(detail.id, name)
    setDeriveName('')
    setDeriveOpen(false)
  }
  // Возможности типа: вкладки выключенных подсистем не показываем — сервер такие
  // запросы всё равно отклоняет (409 feature_unavailable).
  // Пока цепочка типа не пришла (устаревший кэш, заглушки), считаем всё доступным:
  // пустой экран настроек — худший из возможных ответов на отсутствие данных.
  const features = detail.typeChain?.features ?? ALL_PROJECT_FEATURES
  const tabs = ([
    { id: 'general' as const, label: 'Общее' },
    { id: 'llm' as const, label: 'LLM' },
    { id: 'board' as const, label: 'Доска' },
    { id: 'workflow' as const, label: 'Workflow и CI', feature: 'ci' as const },
    { id: 'members' as const, label: 'Участники' },
    { id: 'machines' as const, label: 'Машины', feature: 'machines' as const }
  ]).filter((tab) => !tab.feature || features[tab.feature]).map(({ id, label }) => ({ id, label }))
  // Тип могли сменить, пока открыта вкладка выключенной подсистемы.
  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) setActiveTab('general', { replace: true })
  }, [tabs.map((t) => t.id).join(','), activeTab])
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

  const fieldError = (field: string, _value: string): JSX.Element | null => {
    const error = props.errors[field]
    return error ? <span id={`project-error-${field}`} role="alert" className="proj-error">{error}</span> : null
  }

  return (
    <div className="proj-detail" data-testid="project-settings">
      <SettingsPage
        ariaLabel="Разделы настроек проекта"
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
        tabs={tabs}
      />
      {activeTab === 'general' && <>
      <section className="proj-section" aria-label="Тип и возможности проекта">
        {isOwner && (props.projectTypes?.length ?? 0) > 0 ? (
          <label className="proj-type-field">
            <span className="proj-field-label">Тип проекта</span>
            <select
            className="login-input"
            value={detail.typeId}
            onChange={(e) => void changeType(e.target.value)}
          >
            {(props.projectTypes ?? []).map((type) => (
              <option key={type.id} value={type.id}>{typeOptionLabel(type, props.projectTypes ?? [])}</option>
            ))}
            </select>
          </label>
        ) : (
          <p className="proj-type-current"><span className="proj-field-label">Тип проекта</span> {detail.typeChain?.label || '—'}</p>
        )}
        <ul className="newproj-features" role="list">
          {PROJECT_FEATURES.filter((feature) => features[feature]).map((feature) => (
            <li key={feature} className="newproj-chip" title={PROJECT_FEATURE_LABELS[feature]}>{feature}</li>
          ))}
          {PROJECT_FEATURES.every((feature) => !features[feature]) && (
            <li className="newproj-chip newproj-chip--muted">только доска и задачи</li>
          )}
        </ul>
        {isOwner && props.onDeriveType && (
          <div className="proj-derive">
            {deriveOpen ? (
              <div className="proj-derive-form">
                <label className="proj-invite-field">
                  <span className="proj-field-label">Название нового подтипа</span>
                  <input
                    className="login-input"
                    autoFocus
                    value={deriveName}
                    placeholder="Например, Ремонтный проект"
                    onChange={(e) => setDeriveName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitDerive(); if (e.key === 'Escape') setDeriveOpen(false) }}
                  />
                </label>
                <div className="proj-derive-actions">
                  <Button onClick={submitDerive} disabled={!deriveName.trim()}>Сохранить</Button>
                  <Button variant="ghost" onClick={() => setDeriveOpen(false)}>Отмена</Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setDeriveOpen(true)}>Сохранить как подтип…</Button>
            )}
          </div>
        )}
        {/* Подсказка — после поля: сначала что выбрано, потом что это значит. */}
        <p className="proj-hint">
          Тип задаёт доступные подсистемы. После сохранения новый тип открывает или скрывает разделы, но
          ничего не удаляет: доска, теги и настройки CI остались с момента создания и не
          перезаписываются. «Сохранить как подтип» снимает с проекта копию — колонки доски,
          теги и настройки, — и заводит из неё новый тип под текущим; он останется личным,
          пока вы не отправите его на утверждение.
        </p>
      </section>
      {isOwner ? (
        <div className="proj-meta-edit">
          <input className="login-input" aria-label="Название проекта" aria-invalid={!!props.errors.name} aria-describedby="project-error-name" value={name} onChange={(e) => setName(e.target.value)} />{fieldError('name', name)}
          <textarea className="login-input" aria-label="Описание" placeholder="Описание" value={description} onChange={(e) => setDescription(e.target.value)} />
          {features.git && <><input className="login-input" aria-label="Git-репозиторий" aria-invalid={!!props.errors.gitUrl} aria-describedby="project-error-gitUrl" placeholder="git@…" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} />{fieldError('gitUrl', gitUrl)}</>}
          {features.preview && <><input className="login-input" type="url" aria-label="URL веб-превью" aria-invalid={!!props.errors.previewUrl} aria-describedby="project-error-previewUrl" placeholder="https://example.com" value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} />{fieldError('previewUrl', previewUrl)}</>}
        </div>
      ) : (
        <div className="proj-meta-ro">
          <p>{detail.description || <span className="proj-muted">Без описания</span>}</p>
          {detail.gitUrl && <p className="proj-git">{detail.gitUrl}</p>}
        </div>
      )}

      <TagEditor label="Технологии" tags={detail.technologies} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { technologies: next })} />
      <TagEditor label="Навыки" tags={detail.skills} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { skills: next })} />

      {features.preview && <section className="proj-section" aria-label="Тестовые пользователи">
        <p className="proj-field-label">Тестовые пользователи</p>
        <p className="proj-hint">
          Учётные записи для входа в тестовые окружения проекта из Web Reader: модель получает их
          MCP-инструментом test-users и логинится в окружении сама. Не храните здесь production-пароли.
        </p>
        {testUsers.length === 0 && <p className="proj-muted">Тестовые пользователи не заведены</p>}
        {loginError && <p className="proj-error" role="alert">{loginError}</p>}
        <p className="proj-hint">«Проверить вход» откроет Web Reader и запустит проверку ассистентом. Результат появится в разговоре. Сначала сохраните учётные записи и URL тестового окружения.</p>
        <ul className="proj-test-users" role="list">
          {testUsers.map((user, index) => (
            <li key={index}>
              {isOwner ? <>
                <input className="login-input" aria-label={`Логин тестового пользователя ${index + 1}`} placeholder="Логин" value={user.name} onChange={(e) => patchTestUser(index, { name: e.target.value })} />
                <input className="login-input" type="password" autoComplete="new-password" aria-label={`Пароль тестового пользователя ${index + 1}`} placeholder="Пароль" value={user.password} onChange={(e) => patchTestUser(index, { password: e.target.value })} />
                <input className="login-input" aria-label={`Роль тестового пользователя ${index + 1}`} placeholder="Роль (admin, user…)" value={user.role ?? ''} onChange={(e) => patchTestUser(index, { role: e.target.value })} />
                <input className="login-input" aria-label={`Заметка тестового пользователя ${index + 1}`} placeholder="Что доступно этой учётке" value={user.note ?? ''} onChange={(e) => patchTestUser(index, { note: e.target.value })} />
                {props.onCheckTestLogin && <Button size="sm" disabled={props.unsaved || loginBusy || !detail.previewUrl || !user.name} aria-label={`Проверить вход: ${user.name}`} onClick={() => void checkLogin(user.name)}>Проверить вход</Button>}
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
      </section>}
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
        <label>Типовая команда из CI/CiCommands<select className="login-input" disabled={!isOwner} value="" onChange={event => {
          const command = props.ciCommands?.find(command => command.id === event.target.value)
          if (command) props.onUpdate(detail.id, { testCommand: command.script })
        }}><option value="">Подставить в команду тестирования…</option>{(props.ciCommands ?? []).filter(command => command.scope === 'global' || command.projectId === detail.id).map(command => <option key={command.id} value={command.id}>{command.name}</option>)}</select></label>
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
        <><label>Команда тестирования<textarea rows={2} className="login-input" disabled={!isOwner} aria-invalid={!!props.errors.testCommand} aria-describedby="project-error-testCommand" value={detail.testCommand ?? ''} onChange={(e) => props.onUpdate(detail.id, { testCommand: e.target.value })} placeholder="npm test" /></label>{fieldError('testCommand', detail.testCommand ?? '')}<ProjectCommandCheck project={detail} command={detail.testCommand ?? ''} label="Команда тестирования" /></>
        {/* Пустые поля наследуют команду тестирования — так пост-development
            стадии сужают гейт, а не заводят вторую копию настройки. */}
        <><label>Команда Component QA<textarea rows={2} className="login-input" disabled={!isOwner} aria-invalid={!!props.errors.componentQaCommand} aria-describedby="project-error-componentQaCommand" value={detail.componentQaCommand ?? ''} onChange={(e) => props.onUpdate(detail.id, { componentQaCommand: e.target.value })} placeholder="как команда тестирования" /></label>{fieldError('componentQaCommand', detail.componentQaCommand ?? '')}<ProjectCommandCheck project={detail} command={detail.componentQaCommand ?? ''} label="Команда Component QA" /></>
        <><label>Команда интеграционных тестов<textarea rows={2} className="login-input" disabled={!isOwner} aria-invalid={!!props.errors.integrationTestCommand} aria-describedby="project-error-integrationTestCommand" value={detail.integrationTestCommand ?? ''} onChange={(e) => props.onUpdate(detail.id, { integrationTestCommand: e.target.value })} placeholder="как команда тестирования" /></label>{fieldError('integrationTestCommand', detail.integrationTestCommand ?? '')}<ProjectCommandCheck project={detail} command={detail.integrationTestCommand ?? ''} label="Команда интеграционных тестов" /></>
        <label>Этап Automated QA<select className="sel" disabled={!isOwner} value={detail.automatedQaMode ?? 'command'} onChange={(e) => props.onUpdate(detail.id, { automatedQaMode: e.target.value as AutomatedQaMode })}><option value="command">Команда в воркспейсе</option><option value="playwright">Сценарий в браузере (Playwright)</option></select></label>
        {(detail.automatedQaMode ?? 'command') === 'command'
          ? <><label>Команда Automated QA<textarea rows={2} className="login-input" disabled={!isOwner} aria-invalid={!!props.errors.automatedQaCommand} aria-describedby="project-error-automatedQaCommand" value={detail.automatedQaCommand ?? 'npm test'} onChange={(e) => props.onUpdate(detail.id, { automatedQaCommand: e.target.value })} placeholder="npm test" /></label>{fieldError('automatedQaCommand', detail.automatedQaCommand ?? 'npm test')}<ProjectCommandCheck project={detail} command={detail.automatedQaCommand ?? 'npm test'} label="Команда Automated QA" /></>
          : <AutomatedQaScenarioEditor detail={detail} isOwner={isOwner} onUpdate={props.onUpdate} {...(props.checkAutomatedQa ? { onCheck: props.checkAutomatedQa } : {})} />}
        <label className="pset-check"><input type="checkbox" disabled={!isOwner} checked={detail.autoPilotDefault ?? false} onChange={(e) => props.onUpdate(detail.id, { autoPilotDefault: e.target.checked })} /> Включать автопроход у новых задач</label>
        <label className="pset-check"><input type="checkbox" disabled={!isOwner} checked={detail.autoPilotRequiresManualQa ?? false} onChange={(e) => props.onUpdate(detail.id, { autoPilotRequiresManualQa: e.target.checked })} /> Останавливать новые задачи на ручном QA</label>
        <label>Лимит автоматических доработок<input className="login-input" type="number" min={0} disabled={!isOwner} value={detail.autoPilotFixLimit ?? 3} onChange={(e) => props.onUpdate(detail.id, { autoPilotFixLimit: Math.max(0, Number(e.target.value) || 0) })} /></label>
        {isOwner && <ProductionCheck detail={detail} api={props.managedProductionApi} disabled={props.unsaved} />}
        <p className="proj-field-label" data-testid="production-environment-mode">Режим production: {detail.productionEnvironmentMode==='managed'?'Managed MachineStorage':'Legacy compatibility'}</p>
        {detail.productionEnvironmentMode!=='managed'&&<>
          <p className="proj-muted">Legacy checkout не управляется MachineStorage и сохраняется неизменным при переходе.</p>
          {isOwner&&props.managedProductionApi&&<div className="proj-managed-production" data-testid="managed-production-transition">
            <Button type="button" variant="secondary" disabled={managedProductionBusy || props.unsaved} onClick={() => void runManagedPreflight()}>{managedProductionBusy?'Проверка…':'Проверить Managed production'}</Button>
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
          <Button type="button" variant="secondary" disabled={bootstrapBusy || props.unsaved} onClick={() => void bootstrapProduction()}>{bootstrapBusy?'Подготовка…':'Подготовить прод-машину'}</Button>
          <p className="proj-muted">Создаст хранилище-привязку и каталоги, проставит deploy/health-команды, при необходимости назначит машину для CI/merge и включит Managed. Останется только войти в CLI (`claude login`/`codex login`) на машине.</p>
          {bootstrapError&&<p role="alert" className="proj-error">{bootstrapError}</p>}
          {bootstrapResult&&<div className="proj-managed-preflight" role="status">
            <p>{bootstrapResult.ok?'Готово: Managed production включён.':'Подготовка выполнена, но Managed не включён — проверьте пункты ниже.'}{bootstrapResult.defaultMachineSet?' Машина назначена для CI/merge/тасков.':''}</p>
            <ul>{Object.entries(bootstrapResult.preflight.checks).map(([name,check])=><li key={name}>{name}: {check.ok?'готово':check.message}</li>)}</ul>
            <p className="proj-muted">{bootstrapResult.cliLoginHint}</p>
          </div>}
        </div>}
        <label>Production checkout<input className="login-input" disabled={!isOwner||detail.productionEnvironmentMode==='managed'} value={detail.productionCheckoutPath ?? ''} onChange={(e) => props.onUpdate(detail.id, { productionCheckoutPath: e.target.value })} placeholder="/root/voiceAIChat" /></label>
        <><label>Штатная команда production-деплоя<textarea rows={2} className="login-input" disabled={!isOwner} aria-invalid={!!props.errors.productionDeployCommand} aria-describedby="project-error-productionDeployCommand" value={detail.productionDeployCommand ?? ''} onChange={(e) => props.onUpdate(detail.id, { productionDeployCommand: e.target.value })} placeholder="voicechat-deploy" /></label>{fieldError('productionDeployCommand', detail.productionDeployCommand ?? '')}<ProjectCommandCheck project={detail} command={detail.productionDeployCommand ?? ''} label="Штатная команда production-деплоя" /></>
        <><label>Команда health-check<textarea rows={2} className="login-input" disabled={!isOwner} aria-invalid={!!props.errors.productionHealthCheckCommand} aria-describedby="project-error-productionHealthCheckCommand" value={detail.productionHealthCheckCommand ?? ''} onChange={(e) => props.onUpdate(detail.id, { productionHealthCheckCommand: e.target.value })} placeholder="curl -fsS http://127.0.0.1:8787/api/health" /></label>{fieldError('productionHealthCheckCommand', detail.productionHealthCheckCommand ?? '')}<ProjectCommandCheck project={detail} command={detail.productionHealthCheckCommand ?? ''} label="Команда health-check" /></>
        <><label>CI: базовая ветка<input className="login-input" disabled={!isOwner} aria-invalid={!!props.errors.ciBaseBranch} aria-describedby="project-error-ciBaseBranch" value={detail.ciBaseBranch ?? ''} onChange={(e) => props.onUpdate(detail.id, { ciBaseBranch: e.target.value })} placeholder="main" /></label>{fieldError('ciBaseBranch', detail.ciBaseBranch ?? '')}</>
        <><label>CI: шаблон ветки<input className="login-input" disabled={!isOwner} aria-invalid={!!props.errors.ciBranchTemplate} aria-describedby="project-error-ciBranchTemplate" value={detail.ciBranchTemplate ?? ''} onChange={(e) => props.onUpdate(detail.id, { ciBranchTemplate: e.target.value })} placeholder="{task_number}" /></label>{fieldError('ciBranchTemplate', detail.ciBranchTemplate ?? '')}<p className="proj-hint">Подстановки: {'{task_number}'} → CHAT-123, {'{slug}'} → task-title.</p></>
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
                    <time className="proj-muted" dateTime={isoDate(m.addedAt)}>
                      {' · с ' + formatDate(m.addedAt)}
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
        {isOwner && props.onInvite && (
          <section className="proj-section proj-invites" aria-label="Приглашения">
            <p className="proj-field-label">Пригласить в проект</p>
            <p className="proj-hint">
              Укажите логин или email. Человек получит письмо со ссылкой и сам подтвердит вступление —
              молча в проект никого не добавляем.
            </p>
            {inviteError && <p className="proj-error" role="alert">{inviteError}</p>}
            <div className="proj-invite-form">
              <label className="proj-invite-field">
                <span className="proj-field-label">Логин или email</span>
                <input
                  className="login-input"
                  placeholder="bob или bob@example.com"
                  value={newMember}
                  onChange={(e) => setNewMember(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitInvite() }}
                />
              </label>
              <label className="proj-invite-field proj-invite-field--role">
                <span className="proj-field-label">Роль</span>
                <select className="login-input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value === 'owner' ? 'owner' : 'member')}>
                  <option value="member">Участник</option>
                  <option value="owner">Владелец</option>
                </select>
              </label>
              <label className="proj-invite-field">Срок действия<select className="login-input" value={inviteTtl} onChange={event => setInviteTtl(Number(event.target.value))}><option value={1}>1 день</option><option value={7}>7 дней</option><option value={30}>30 дней</option></select></label>
              <Button onClick={() => void submitInvite()} loading={inviting} disabled={!newMember.trim() || inviting}>Пригласить</Button>
            </div>

            {(props.invitations?.length ?? 0) > 0 && <>
              <p className="proj-field-label">Ожидают ответа</p>
              <ul className="proj-invite-list" role="list">
                {(props.invitations ?? []).map((invitation) => (
                  <li key={invitation.id}>
                    <span className="proj-invite-who">
                      {invitation.email ?? invitation.invitedUsername}
                      <span className="proj-muted">
                        {invitation.role === 'owner' ? ' · владелец' : ' · участник'}
                        {/* У проекта может быть несколько владельцев — при разборе
                            «кто позвал» это первый вопрос. */}
                        {' · пригласил '}{invitation.invitedBy}
                        {' · до '}
                        <time dateTime={isoDate(invitation.expiresAt)}>{formatDate(invitation.expiresAt)}</time>
                      </span>
                    </span>
                    <span className="proj-invite-actions">
                      {props.onResendInvitation && (
                        <Button size="sm" variant="secondary" onClick={() => props.onResendInvitation?.(detail.id, invitation.id)}>Отправить снова</Button>
                      )}
                      {props.onRevokeInvitation && (
                        <IconButton
                          size="sm"
                          className="vc-btn--danger-quiet"
                          aria-label={`Отозвать приглашение ${invitation.email ?? invitation.invitedUsername}`}
                          title="Отозвать приглашение"
                          onClick={() => props.onRevokeInvitation?.(detail.id, invitation.id)}
                        >
                          ✕
                        </IconButton>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>}
          </section>
        )}
      </div>}

      {activeTab === 'machines' && <><div className="proj-section"><label>Связка проекта и машины<select className="sel" aria-label="Машина для Git-доступа" value={selectedGitMachineId} onChange={(event) => { setSelectedGitMachineId(event.target.value); setMachineTab('settings') }}><option value="">Выберите машину</option>{detail.machines.filter((machine) => machine.sharedWithProject || machine.ownership === 'mine').map((machine) => <option key={machine.agentId} value={machine.agentId}>{machine.name ?? machine.agentId}</option>)}</select></label>{selectedGitMachineId && <div role="tablist" aria-label="Настройки связки"><Button size="sm" onClick={() => setMachineTab('settings')}>Настройки</Button><Button size="sm" onClick={() => setMachineTab('git')}>Git-доступ</Button></div>}</div>{machineTab === 'settings' && <ProjectMachinesSettings
        projectId={detail.id}
        productionAgentId={detail.productionAgentId}
        defaultAgentId={detail.defaultAgentId}
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
