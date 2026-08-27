// adminStore — администрирование пользователей и стоимости моделей (CHAT-236).
//
// Домен активируется только при открытии админки: обычный bootstrap его не
// грузит. При logout или потере роли данные полностью очищаются.

import type {
  AdminLlmEngine,
  AdminLlmEngineHealth,
  AdminLlmEngineInput,
  AdminUserInfo,
  ModelPrice,
  ModelPriceInput,
  UsageReport,
  UsageUnit,
  UserUsageSummary, AdminMakeStats, SecurityEvent, InviteInfo } from '@shared/admin'
import type { UserLlmAccess } from '@shared/llmAccess'

export const EMPTY_LLM_ACCESS: readonly UserLlmAccess[] = Object.freeze([])
import type { Conversation, Message, UserRole, SessionInfo } from '@shared/types'
import type { AdminClient, SessionPort } from '../contracts'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
import { createStoreCore, type Store } from './core'

export interface AdminState {
  /** Открыта ли админ-страница пользователей. */
  usersOpen: boolean
  adminUsers: AdminUserInfo[]
  adminUsageSummary: UserUsageSummary[]
  adminMakeStats: AdminMakeStats | null
  adminUsersStatus: LoadStatus
  adminUsersError: string | null
  adminSelected: string | null
  adminUsage: UsageReport | null
  /** Сессии выбранного пользователя (auth-roadmap п.4); null — не загружены. */
  adminSessions: SessionInfo[] | null
  /** Журнал безопасности выбранного пользователя (auth-roadmap п.7). */
  adminSecurity: SecurityEvent[] | null
  /** Инвайты (auth-roadmap п.8). */
  adminInvites: InviteInfo[] | null
  adminConversations: Conversation[]
  adminMessages: Message[]
  adminConversationId: string | null
  adminLlmEngines: AdminLlmEngine[]
  adminLlmEnginesStatus: LoadStatus
  adminLlmEnginesError: string | null
  adminLlmEngineHealth: Record<string, AdminLlmEngineHealth | undefined>
  adminModelPrices: ModelPrice[]
  /** Права выбранного пользователя. Пустой deny-list = полный доступ. */
  adminUserLlmAccess: UserLlmAccess[]
}

export interface AdminActions {
  openUsers(): Promise<void>
  closeUsers(): void
  createUserAccount(name: string, password: string, role: UserRole): Promise<void>
  updateUserRole(name: string, role: UserRole): Promise<void>
  setUserBlocked(name: string, blocked: boolean): Promise<void>
  deleteUserAccount(name: string): Promise<void>
  selectAdminUser(name: string): Promise<void>
  loadAdminUsage(unit: UsageUnit, from?: number, to?: number, conversationId?: string): Promise<void>
  loadAdminSessions(): Promise<void>
  loadAdminSecurity(): Promise<void>
  loadAdminInvites(): Promise<void>
  createAdminInvite(input: { role: UserRole; ttlHours?: number; maxUses?: number; note?: string }): Promise<InviteInfo | null>
  deleteAdminInvite(token: string): Promise<void>
  revokeAdminSession(sid: string): Promise<void>
  openAdminConversation(conversationId: string): Promise<void>
  refreshAdminLlmEngines(): Promise<void>
  refreshAdminModelPrices(): Promise<void>
  saveAdminModelPrice(input: ModelPriceInput): Promise<void>
  deleteAdminModelPrice(provider: string, model: string): Promise<void>
  createAdminLlmEngine(input: AdminLlmEngineInput): Promise<void>
  updateAdminLlmEngine(id: string, patch: AdminLlmEngineInput): Promise<void>
  deleteAdminLlmEngine(id: string): Promise<void>
  checkAdminLlmEngineHealth(id: string): Promise<void>
  loadAdminUserLlmAccess(name?: string): Promise<void>
  saveAdminUserLlmAccess(access: UserLlmAccess[]): Promise<void>
  reset(): void
}

export type AdminStore = Store<AdminState, AdminActions>

export interface AdminDeps {
  client: AdminClient
  session: SessionPort
  fail?: (err: unknown, retry?: () => void) => void
  notify?: (notice: { kind: 'error' | 'success' | 'info'; text: string }) => void
}

function initialState(): AdminState {
  return {
    usersOpen: false,
    adminUsers: [],
    adminUsageSummary: [],
    adminMakeStats: null,
    adminUsersStatus: 'loading',
    adminUsersError: null,
    adminSelected: null,
    adminUsage: null,
    adminSessions: null,
    adminSecurity: null,
    adminInvites: null,
    adminConversations: [],
    adminMessages: [],
    adminConversationId: null,
    adminLlmEngines: [],
    adminLlmEnginesStatus: 'loading',
    adminLlmEnginesError: null,
    adminLlmEngineHealth: {},
    adminModelPrices: [],
    adminUserLlmAccess: []
  }
}

export function createAdminStore(deps: AdminDeps): AdminStore {
  const client = deps.client
  const core = createStoreCore<AdminState>(initialState())
  const { getState, setState } = core
  const fail = deps.fail ?? (() => {})

  async function refreshAdminUsers(): Promise<void> {
    setState({ adminUsersStatus: 'loading', adminUsersError: null })
    try {
      const [adminUsers, adminUsageSummary, adminMakeStats] = await Promise.all([
        client.listUsers(),
        client.usageSummary(),
        // Метрики Make — необязательная часть дашборда: их отказ не должен ронять список пользователей.
        client.makeStats ? client.makeStats().catch(() => null) : Promise.resolve(null)
      ])
      setState({ adminUsers, adminUsageSummary, adminMakeStats, adminUsersStatus: 'ready', adminUsersError: null })
    } catch (err) {
      setState({
        adminUsersStatus: 'error',
        adminUsersError: err instanceof Error ? err.message : String(err)
      })
      throw err
    }
  }

  async function refreshAdminLlmEngines(): Promise<void> {
    setState({ adminLlmEnginesStatus: 'loading', adminLlmEnginesError: null })
    try {
      setState({
        adminLlmEngines: await client.listLlmEngines(),
        adminLlmEnginesStatus: 'ready',
        adminLlmEnginesError: null
      })
    } catch (err) {
      setState({
        adminLlmEnginesStatus: 'error',
        adminLlmEnginesError: err instanceof Error ? err.message : String(err)
      })
      throw err
    }
  }

  async function refreshAdminModelPrices(): Promise<void> {
    try {
      setState({ adminModelPrices: await client.listModelPrices() })
    } catch (err) {
      fail(err, () => void refreshAdminModelPrices())
    }
  }

  function closeUsers(): void {
    setState({
      usersOpen: false,
      adminSelected: null,
      adminUsage: null,
    adminSessions: null,
    adminSecurity: null,
    adminInvites: null,
      adminConversations: [],
      adminMessages: [],
      adminConversationId: null,
      adminLlmEngineHealth: {}
    })
  }

  let selectionRequest = 0

  async function selectAdminUser(name: string): Promise<void> {
    const request = ++selectionRequest
    setState({
      adminSelected: name,
      adminUsage: null,
    adminSessions: null,
    adminSecurity: null,
    adminInvites: null,
      adminConversations: [],
      adminMessages: [],
      adminConversationId: null,
      adminUserLlmAccess: []
    })
    try {
      const [usage, conversations, access] = await Promise.all([
        client.userUsage({ name, unit: 'day' }),
        client.userConversations({ name }),
        client.getUserLlmAccess({ name })
      ])
      if (request !== selectionRequest || getState().adminSelected !== name) return
      setState({ adminUsage: usage, adminConversations: conversations, adminUserLlmAccess: access })
    } catch (err) {
      if (request === selectionRequest) fail(err, () => void selectAdminUser(name))
    }
  }

  async function openUsers(): Promise<void> {
    setState({ usersOpen: true })
    try {
      await Promise.all([refreshAdminUsers(), refreshAdminLlmEngines(), refreshAdminModelPrices()])
    } catch (err) {
      fail(err, () => void openUsers())
    }
  }

  async function loadAdminUserLlmAccess(name = getState().adminSelected ?? ''): Promise<void> {
    if (!name) return
    try {
      setState({ adminUserLlmAccess: await client.getUserLlmAccess({ name }) })
    } catch (err) {
      fail(err, () => void loadAdminUserLlmAccess(name))
    }
  }

  async function loadAdminUsage(
    unit: UsageUnit,
    from?: number,
    to?: number,
    conversationId?: string
  ): Promise<void> {
    const name = getState().adminSelected
    if (!name) return
    try {
      setState({ adminUsage: await client.userUsage({ name, unit, from, to, conversationId }) })
    } catch (err) {
      fail(err, () => void loadAdminUsage(unit, from, to, conversationId))
    }
  }

  async function loadAdminSessions(): Promise<void> {
    const name = getState().adminSelected
    if (!name || !client.userSessions) return
    try { setState({ adminSessions: await client.userSessions({ name }) }) } catch (err) { fail(err, () => void loadAdminSessions()) }
  }

  async function loadAdminSecurity(): Promise<void> {
    const name = getState().adminSelected
    if (!name || !client.securityEvents) return
    try { setState({ adminSecurity: await client.securityEvents({ user: name, limit: 200 }) }) } catch (err) { fail(err, () => void loadAdminSecurity()) }
  }

  async function loadAdminInvites(): Promise<void> {
    if (!client.listInvites) return
    try { setState({ adminInvites: await client.listInvites() }) } catch (err) { fail(err, () => void loadAdminInvites()) }
  }
  async function createAdminInvite(input: { role: UserRole; ttlHours?: number; maxUses?: number; note?: string }): Promise<InviteInfo | null> {
    if (!client.createInvite) return null
    try { const inv = await client.createInvite(input); await loadAdminInvites(); return inv } catch (err) { fail(err, () => void createAdminInvite(input)); return null }
  }
  async function deleteAdminInvite(token: string): Promise<void> {
    if (!client.deleteInvite) return
    try { await client.deleteInvite({ token }); await loadAdminInvites() } catch (err) { fail(err, () => void deleteAdminInvite(token)) }
  }

  async function revokeAdminSession(sid: string): Promise<void> {
    if (!client.revokeSession) return
    try { await client.revokeSession({ sid }); await loadAdminSessions() } catch (err) { fail(err, () => void revokeAdminSession(sid)) }
  }

  async function openAdminConversation(conversationId: string): Promise<void> {
    const name = getState().adminSelected
    if (!name) return
    setState({ adminConversationId: conversationId, adminMessages: [] })
    try {
      setState({ adminMessages: await client.userMessages({ name, conversationId }) })
    } catch (err) {
      fail(err, () => void openAdminConversation(conversationId))
    }
  }

  async function saveAdminUserLlmAccess(access: UserLlmAccess[]): Promise<void> {
    const name = getState().adminSelected
    if (!name) return
    try {
      setState({ adminUserLlmAccess: await client.replaceUserLlmAccess({ name, access }) })
      deps.notify?.({ kind: 'success', text: 'Доступ к моделям сохранён' })
    } catch (err) {
      fail(err, () => void saveAdminUserLlmAccess(access))
    }
  }

  async function checkAdminLlmEngineHealth(id: string): Promise<void> {
    try {
      const health = await client.checkLlmEngineHealth({ id })
      setState({ adminLlmEngineHealth: { ...getState().adminLlmEngineHealth, [id]: health } })
    } catch (err) {
      fail(err, () => void checkAdminLlmEngineHealth(id))
    }
  }

  async function setUserBlocked(name: string, blocked: boolean): Promise<void> {
    try {
      await client.setUserBlocked({ name, blocked })
      await refreshAdminUsers()
    } catch (err) {
      fail(err, () => void setUserBlocked(name, blocked))
    }
  }

  return {
    getState,
    subscribe: core.subscribe,
    dispose: core.dispose,
    actions: {
      openUsers,
      closeUsers,
      async createUserAccount(name, password, role) {
        try {
          await client.createUser({ name, password, role })
          await refreshAdminUsers()
        } catch (err) {
          fail(err)
        }
      },
      async updateUserRole(name, role) {
        try {
          await client.updateUserRole({ name, role })
          await refreshAdminUsers()
          if (name === deps.session.currentUser()?.name) {
            const current = await deps.session.refreshSession()
            await deps.session.refreshOwnLlmAccess()
            if (current?.role !== 'admin') {
              core.resetState(initialState())
              deps.session.onAdminAccessLost?.()
            }
          }
        } catch (err) { fail(err) }
      },
      setUserBlocked,
      async deleteUserAccount(name) {
        try {
          await client.deleteUser({ name })
          if (getState().adminSelected === name) closeUsers()
          await refreshAdminUsers()
        } catch (err) {
          fail(err)
        }
      },
      selectAdminUser,
      loadAdminUsage,
      loadAdminSessions,
    loadAdminSecurity,
    loadAdminInvites,
    createAdminInvite,
    deleteAdminInvite,
      revokeAdminSession,
      openAdminConversation,
      refreshAdminLlmEngines,
      refreshAdminModelPrices,
      async saveAdminModelPrice(input) {
        try {
          await client.saveModelPrice(input)
          await refreshAdminModelPrices()
        } catch (err) {
          fail(err)
        }
      },
      async deleteAdminModelPrice(provider, model) {
        try {
          await client.deleteModelPrice({ provider, model })
          await refreshAdminModelPrices()
        } catch (err) {
          fail(err)
        }
      },
      async createAdminLlmEngine(input) {
        try {
          await client.createLlmEngine(input)
          await refreshAdminLlmEngines()
        } catch (err) {
          fail(err)
        }
      },
      async updateAdminLlmEngine(id, patch) {
        try {
          await client.updateLlmEngine({ id, patch })
          await refreshAdminLlmEngines()
        } catch (err) {
          fail(err)
        }
      },
      async deleteAdminLlmEngine(id) {
        try {
          await client.deleteLlmEngine({ id })
          const nextHealth = { ...getState().adminLlmEngineHealth }
          delete nextHealth[id]
          setState({ adminLlmEngineHealth: nextHealth })
          await refreshAdminLlmEngines()
        } catch (err) {
          fail(err)
        }
      },
      checkAdminLlmEngineHealth,
      loadAdminUserLlmAccess,
      saveAdminUserLlmAccess,
      reset() {
        core.resetState(initialState())
      }
    }
  }
}

