// operationsStore — машины, их утилиты и наблюдатели сессий CLI (CHAT-236).
//
// Публичный фасад пока один, внутри он разделён на контроллеры: машины,
// утилиты (консоль/проводник), наблюдатели Claude Code и Codex. Так домен
// готов к выделению в отдельное приложение Operations без смены потребителей.
//
// Live-tail и локальные подписки закрываются при уходе со страницы, смене
// выбранной сущности, logout и dispose.

import type { AgentCreated, AgentExecResult, AgentInfo, AgentPolicy, FsResult, FsCopyResult } from '@shared/agentProtocol'
import { AGENT_TOKEN_DEFAULT_TTL_DAYS } from '@shared/agentProtocol'
import type { ConversationWithMessages, ServerFileInfo } from '@shared/protocol'
import type { CcItem, CcProject, CcSession } from '@shared/cc'
import type { CxItem, CxProject, CxSession } from '@shared/codexSessions'
import type { SessionUsage } from '@shared/types'
import type { MachineStorage } from '@shared/projects'
import type { LoadStatus } from '../../lib/loadState'
import type { DownloadPort, OperationsClient } from '../../clients/types'
import { createStoreCore, type Store } from '../createStore'

/** Сколько команд консоли помним по одной машине (дальше вытесняются старые). */
import type { UtilityKind } from '../../components/machine'

const CONSOLE_HISTORY_MAX = 100
/** Потолок роста транскрипта наблюдателя. */
const TRANSCRIPT_CAP = 4000

/** Открытая из меню машинная утилита. */
export interface UtilityTarget {
  kind: UtilityKind
  agentId: string | null
  path?: string
  dir?: boolean
  projectId?: string
  /** Команда для немедленного выполнения в консоли (навык машины из шапки чата). */
  command?: string
  /**
   * Для панели кода — чья рабочая копия. Путь тут не годится: панель адресуется
   * рабочей копией (задача или разговор), а её резолвит сервер.
   */
  gitTarget?: { projectId: string; conversationId?: string; taskId?: string }
}

export interface OperationsState {
  agents: AgentInfo[]
  agentsStatus: LoadStatus
  agentsError: string | null
  machineStorages: Record<string, MachineStorage[]>
  /** Открыто ли меню «Машины». */
  machinesOpen: boolean
  /** Открытая утилита (консоль/проводник) + машина; null — закрыта. */
  utility: UtilityTarget | null
  /** Набранные в консоли команды по id машины (старые → новые). */
  consoleHistory: Record<string, string[]>
  // --- Наблюдатель Claude Code ---
  ccOpen: boolean
  ccProjects: CcProject[]
  ccSessions: CcSession[]
  ccTranscript: CcItem[]
  ccProjectSlug: string | null
  ccSessionId: string | null
  ccUsage: SessionUsage | null
  // --- Наблюдатель Codex ---
  cxOpen: boolean
  cxProjects: CxProject[]
  cxSessions: CxSession[]
  cxTranscript: CxItem[]
  cxProjectCwd: string | null
  cxSessionId: string | null
  cxUsage: SessionUsage | null
}

export interface OperationsActions {
  refreshAgents(): Promise<void>
  applyAgents(agents: AgentInfo[]): void
  createAgent(name: string): Promise<AgentCreated | null>
  deleteAgent(id: string): Promise<void>
  setAgentPolicy(id: string, policy: AgentPolicy): Promise<void>
  refreshMachineStorages(id: string): Promise<void>
  registerMachineStorage(id: string, rootPath: string): Promise<string | null>
  regenerateAgentToken(id: string): Promise<string | null>
  updateAgent(id: string): Promise<string | null>
  getAgentConnectionString(token: string): Promise<string | null>
  downloadDesktopApp(): Promise<void>
  downloadAgentApp(): Promise<void>
  downloadAgentScript(): Promise<void>
  openMachines(): void
  closeMachines(): void
  // --- Утилиты машины ---
  openUtility(kind: UtilityKind, agentId?: string | null, path?: string, dir?: boolean): void
  openUtilityForActiveChat(kind: UtilityKind): void
  /** Открыть консоль машины и сразу выполнить команду навыка. */
  runSkill(agentId: string, command: string): void
  closeUtility(): void
  fsList(agentId: string, path: string): Promise<FsResult>
  fsRead(agentId: string, path: string): Promise<FsResult>
  fsWrite(agentId: string, path: string, dataBase64: string): Promise<FsResult>
  fsRemove(agentId: string, path: string): Promise<FsResult>
  fsTrash(agentId: string, path: string): Promise<FsResult>
  fsCopyTo(agentId: string, path: string, targetAgentId: string, targetDir?: string): Promise<FsCopyResult>
  /** Токен машины (п.11): отзыв и привязка к IP; после обоих список машин перечитывается. */
  revokeAgentToken(id: string): Promise<void>
  setAgentPinIp(id: string, pin: boolean): Promise<void>
  fsRename(agentId: string, from: string, to: string): Promise<FsResult>
  fsMkdir(agentId: string, path: string): Promise<FsResult>
  downloadFsFile(agentId: string, path: string, name: string): Promise<void>
  uploadFsFile(agentId: string, dir: string, file: File): Promise<FsResult>
  agentExec(agentId: string, command: string, signal?: AbortSignal): Promise<AgentExecResult>
  readServerFile(path: string): Promise<ServerFileInfo | null>
  pushConsoleCommand(agentId: string, command: string): void
  // --- Наблюдатели ---
  openObserver(): Promise<void>
  closeObserver(): void
  selectCcProject(slug: string): Promise<void>
  selectCcSession(slug: string, id: string): Promise<void>
  resumeCcSession(slug: string, id: string): Promise<ConversationWithMessages | null>
  applyCcTailItems(items: CcItem[]): void
  openCodexObserver(): Promise<void>
  closeCodexObserver(): void
  selectCxProject(cwd: string): Promise<void>
  selectCxSession(id: string): Promise<void>
  resumeCxSession(id: string): Promise<ConversationWithMessages | null>
  applyCxTailItems(items: CxItem[]): void
  reset(): void
}

export type OperationsStore = Store<OperationsState, OperationsActions>

export interface OperationsDeps {
  operations: OperationsClient
  download: DownloadPort
  /** Эффективная машина и папка активного чата — их владелец chatStore. */
  activeChat: () => { execTarget: string | null; workdir: string | null; projectId: string | undefined; conversationId?: string | null }
  fail?: (err: unknown, retry?: () => void) => void
  /** Машину удалили — runtime разошлёт это остальным доменам. */
  onAgentDeleted?: (id: string) => void
}

function initialState(): OperationsState {
  return {
    agents: [],
    agentsStatus: 'loading',
    agentsError: null,
    machineStorages: {},
    machinesOpen: false,
    utility: null,
    consoleHistory: {},
    ccOpen: false,
    ccProjects: [],
    ccSessions: [],
    ccTranscript: [],
    ccProjectSlug: null,
    ccSessionId: null,
    ccUsage: null,
    cxOpen: false,
    cxProjects: [],
    cxSessions: [],
    cxTranscript: [],
    cxProjectCwd: null,
    cxSessionId: null,
    cxUsage: null
  }
}

/** Кодирует File в base64 (без префикса data:) для загрузки на машину. */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function createOperationsStore(deps: OperationsDeps): OperationsStore {
  const client = deps.operations
  const core = createStoreCore<OperationsState>(initialState())
  const { getState, setState } = core
  const fail = deps.fail ?? (() => {})

  function stopTails(): void {
    client.ccTailStop?.()
    client.cxTailStop?.()
  }

  core.onDispose(stopTails)

  async function refreshAgents(): Promise<void> {
    if (!client['agents:list']) return
    setState({ agentsStatus: 'loading', agentsError: null })
    try {
      const agents = await client['agents:list']()
      setState({ agents, agentsStatus: 'ready', agentsError: null })
      await Promise.all(agents.map((agent) => refreshMachineStorages(agent.id)))
    } catch (err) {
      // Промах в console.warn выглядел как «машин нет» — теперь состояние видно.
      console.warn('[agents] не удалось получить список машин', err)
      setState({ agentsStatus: 'error', agentsError: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Машина утилиты: сначала цель активного чата, затем первая онлайн. */
  function defaultUtilityAgent(): string | null {
    const target = deps.activeChat().execTarget
    const own = getState().agents.find((a) => a.id === target && a.online)
    if (own) return own.id
    return getState().agents.find((a) => a.online)?.id ?? getState().agents[0]?.id ?? null
  }

  const noFs = (): never => {
    throw new Error('Файловые операции недоступны')
  }

  function projectId(): string | undefined {
    return deps.activeChat().projectId
  }

  async function setAgentPolicy(id: string, policy: AgentPolicy): Promise<void> {
    try {
      await client['agents:setPolicy']({ id, policy })
      setState({ agents: getState().agents.map((a) => (a.id === id ? { ...a, policy } : a)) })
    } catch (err) {
      fail(err, () => void setAgentPolicy(id, policy))
    }
  }

  async function refreshMachineStorages(id: string): Promise<void> {
    try {
      const storages = await client['agents:listStorages']({ id })
      setState({ machineStorages: { ...getState().machineStorages, [id]: storages } })
    } catch (err) {
      fail(err, () => void refreshMachineStorages(id))
    }
  }

  async function downloadArtifact(kind: 'desktop' | 'agent-app' | 'agent-script'): Promise<void> {
    try {
      deps.download.open(await client['downloads:url']({ kind }))
    } catch (err) {
      fail(err, () => void downloadArtifact(kind))
    }
  }

  return {
    getState,
    subscribe: core.subscribe,
    dispose: core.dispose,
    actions: {
      refreshAgents,
      applyAgents: (agents) => setState({ agents }),
      async createAgent(name) {
        try {
          const created = await client['agents:create']({ name })
          await refreshAgents()
          return created
        } catch (err) {
          fail(err)
          return null
        }
      },
      async deleteAgent(id) {
        try {
          await client['agents:delete']({ id })
        } catch (err) {
          fail(err)
          return
        }
        // Цель выполнения сбрасывает и сервер, и остальные домены — иначе до
        // перезагрузки страницы селекторы показывали бы удалённую машину.
        deps.onAgentDeleted?.(id)
        await refreshAgents()
      },
      setAgentPolicy,
      refreshMachineStorages,
      async registerMachineStorage(id, rootPath) {
        try {
          await client['agents:registerStorage']({ id, rootPath })
          await refreshMachineStorages(id)
          return null
        } catch (err) {
          return err instanceof Error ? err.message : String(err)
        }
      },
      async regenerateAgentToken(id) {
        try {
          const { token } = await client['agents:regenerateToken']({ id, ttlDays: AGENT_TOKEN_DEFAULT_TTL_DAYS })
          return token
        } catch (err) {
          fail(err)
          return null
        }
      },
      async updateAgent(id) {
        try {
          await client['agents:update']({ id })
          return null
        } catch (err) {
          return err instanceof Error ? err.message : String(err)
        }
      },
      async getAgentConnectionString(token) {
        try {
          return await client['agents:connectionString']({ token })
        } catch (err) {
          fail(err)
          return null
        }
      },
      downloadDesktopApp: () => downloadArtifact('desktop'),
      downloadAgentApp: () => downloadArtifact('agent-app'),
      downloadAgentScript: () => downloadArtifact('agent-script'),
      openMachines() {
        setState({ machinesOpen: true })
        void refreshAgents()
      },
      closeMachines() {
        setState({ machinesOpen: false })
      },
      openUtility(kind, agentId, path, dir) {
        setState({
          utility: {
            kind,
            agentId: agentId ?? defaultUtilityAgent(),
            ...(path ? { path } : {}),
            ...(path && dir ? { dir: true } : {})
          }
        })
      },
      runSkill(agentId, command) {
        setState({ utility: { kind: 'console', agentId, command } })
      },
      openUtilityForActiveChat(kind) {
        const { execTarget, workdir, projectId: pid, conversationId } = deps.activeChat()
        // Утилита остаётся на эффективной машине чата даже во время
        // переподключения: иначе проводник открывался бы на чужой машине.
        const agentId = execTarget && execTarget !== 'none' ? execTarget : defaultUtilityAgent()
        setState({
          utility: {
            kind,
            agentId,
            ...(workdir ? { path: workdir } : {}),
            ...(workdir && kind === 'explorer' ? { dir: true } : {}),
            ...(pid ? { projectId: pid } : {}),
            // Панель кода адресуется рабочей копией, а не путём: цель — разговор
            // этого чата вместе с его проектом.
            ...(kind === 'git' && pid && conversationId ? { gitTarget: { projectId: pid, conversationId } } : {})
          }
        })
      },
      closeUtility() {
        setState({ utility: null })
      },
      fsList(agentId, path) {
        if (!client.fs) return noFs()
        const pid = projectId()
        return pid ? client.fs.list(agentId, path, pid) : client.fs.list(agentId, path)
      },
      fsRead(agentId, path) {
        if (!client.fs) return noFs()
        const pid = projectId()
        return pid ? client.fs.read(agentId, path, pid) : client.fs.read(agentId, path)
      },
      fsWrite: (agentId, path, dataBase64) =>
        client.fs ? client.fs.write(agentId, path, dataBase64, projectId()) : noFs(),
      fsRemove: (agentId, path) => (client.fs ? client.fs.remove(agentId, path, projectId()) : noFs()),
      fsTrash: (agentId, path) => (client.fs?.trash ? client.fs.trash(agentId, path, projectId()) : noFs()),
      async revokeAgentToken(id) { await client['agents:revokeToken']({ id }); await refreshAgents() },
      async setAgentPinIp(id, pin) { await client['agents:setPinIp']({ id, pin }); await refreshAgents() },
      fsCopyTo: (agentId, path, targetAgentId, targetDir) => (client.fs?.copyTo ? client.fs.copyTo(agentId, path, targetAgentId, targetDir, projectId()) : noFs()),
      fsRename: (agentId, from, to) => (client.fs ? client.fs.rename(agentId, from, to, projectId()) : noFs()),
      fsMkdir: (agentId, path) => (client.fs ? client.fs.mkdir(agentId, path, projectId()) : noFs()),
      async downloadFsFile(agentId, path, name) {
        if (!client.fs) return
        const res = await client.fs.read(agentId, path, projectId())
        const bytes = Uint8Array.from(atob(res.dataBase64 ?? ''), (c) => c.charCodeAt(0))
        deps.download.bytes(name, bytes)
      },
      async uploadFsFile(agentId, dir, file) {
        if (!client.fs) return noFs()
        const dataBase64 = await fileToBase64(file)
        const path = `${dir.replace(/\/$/, '')}/${file.name}`
        return client.fs.write(agentId, path, dataBase64, projectId())
      },
      agentExec(agentId, command, signal) {
        if (!client.fs) return noFs()
        const pid = projectId()
        return pid ? client.fs.exec(agentId, command, signal, pid) : client.fs.exec(agentId, command, signal)
      },
      readServerFile: (path) => (client.files ? client.files.read(path) : Promise.resolve(null)),
      pushConsoleCommand(agentId, command) {
        // Подряд повторённую команду не дублируем — под ↑ она и так первая.
        const cmd = command.trim()
        if (!agentId || !cmd) return
        const prev = getState().consoleHistory[agentId] ?? []
        if (prev[prev.length - 1] === cmd) return
        setState({
          consoleHistory: { ...getState().consoleHistory, [agentId]: [...prev, cmd].slice(-CONSOLE_HISTORY_MAX) }
        })
      },
      async openObserver() {
        setState({ ccOpen: true })
        if (!client['cc:projects']) return
        try {
          setState({ ccProjects: await client['cc:projects']() })
        } catch (err) {
          console.warn('[cc] не удалось получить проекты', err)
        }
      },
      closeObserver() {
        client.ccTailStop?.()
        setState({
          ccOpen: false,
          ccProjectSlug: null,
          ccSessionId: null,
          ccSessions: [],
          ccTranscript: [],
          ccUsage: null
        })
      },
      async selectCcProject(slug) {
        client.ccTailStop?.()
        setState({ ccProjectSlug: slug, ccSessionId: null, ccSessions: [], ccTranscript: [], ccUsage: null })
        try {
          setState({ ccSessions: await client['cc:sessions']({ slug }) })
        } catch (err) {
          console.warn('[cc] не удалось получить сессии', err)
        }
      },
      async selectCcSession(slug, id) {
        client.ccTailStop?.()
        setState({ ccProjectSlug: slug, ccSessionId: id, ccTranscript: [], ccUsage: null })
        try {
          const { items, usage } = await client['cc:transcript']({ slug, id })
          setState({ ccTranscript: items, ccUsage: usage })
        } catch (err) {
          console.warn('[cc] не удалось получить транскрипт', err)
        }
        client.ccTailStart?.(slug, id) // live-слежение за активной сессией
      },
      async resumeCcSession(slug, id) {
        if (!client['cc:resume']) return null
        try {
          const result = await client['cc:resume']({ slug, id })
          client.ccTailStop?.()
          setState({
            ccOpen: false,
            ccProjectSlug: null,
            ccSessionId: null,
            ccSessions: [],
            ccTranscript: [],
            ccUsage: null
          })
          return result
        } catch (err) {
          fail(err)
          return null
        }
      },
      applyCcTailItems(items) {
        if (items.length === 0) return
        const next = [...getState().ccTranscript, ...items]
        setState({ ccTranscript: next.length > TRANSCRIPT_CAP ? next.slice(-TRANSCRIPT_CAP) : next })
      },
      applyCxTailItems(items) {
        if (items.length === 0) return
        const next = [...getState().cxTranscript, ...items]
        setState({ cxTranscript: next.length > TRANSCRIPT_CAP ? next.slice(-TRANSCRIPT_CAP) : next })
      },
      async openCodexObserver() {
        setState({ cxOpen: true })
        if (!client['cx:projects']) return
        try {
          setState({ cxProjects: await client['cx:projects']() })
        } catch (err) {
          console.warn('[cx] не удалось получить проекты', err)
        }
      },
      closeCodexObserver() {
        client.cxTailStop?.()
        setState({
          cxOpen: false,
          cxProjectCwd: null,
          cxSessionId: null,
          cxSessions: [],
          cxTranscript: [],
          cxUsage: null
        })
      },
      async selectCxProject(cwd) {
        client.cxTailStop?.()
        setState({ cxProjectCwd: cwd, cxSessionId: null, cxSessions: [], cxTranscript: [], cxUsage: null })
        try {
          setState({ cxSessions: await client['cx:sessions']({ cwd }) })
        } catch (err) {
          console.warn('[cx] не удалось получить сессии', err)
        }
      },
      async selectCxSession(id) {
        client.cxTailStop?.()
        setState({ cxSessionId: id, cxTranscript: [], cxUsage: null })
        try {
          const { items, usage } = await client['cx:transcript']({ id })
          setState({ cxTranscript: items, cxUsage: usage })
        } catch (err) {
          console.warn('[cx] не удалось получить транскрипт', err)
        }
        client.cxTailStart?.(id) // live-слежение за активной сессией
      },
      async resumeCxSession(id) {
        if (!client['cx:resume']) return null
        try {
          const result = await client['cx:resume']({ id })
          client.cxTailStop?.()
          setState({
            cxOpen: false,
            cxProjectCwd: null,
            cxSessionId: null,
            cxSessions: [],
            cxTranscript: [],
            cxUsage: null
          })
          return result
        } catch (err) {
          fail(err)
          return null
        }
      },
      reset() {
        stopTails()
        core.resetState(initialState())
      }
    }
  }
}

