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
  UserUsageSummary
} from '@shared/admin'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { Conversation, Message, SessionUser, UserRole } from '@shared/types'
import type { LoadStatus } from '../../lib/loadState'
import type { AdminClient } from '../../clients/types'
import { createStoreCore, type Store } from '../createStore'

export interface AdminState {
  /** Открыта ли админ-страница пользователей. */
  usersOpen: boolean
  adminUsers: AdminUserInfo[]
  adminUsageSummary: UserUsageSummary[]
  adminUsersStatus: LoadStatus
  adminUsersError: string | null
  adminSelected: string | null
  adminUsage: UsageReport | null
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
  setUserBlocked(name: string, blocked: boolean): Promise<void>
  deleteUserAccount(name: string): Promise<void>
  selectAdminUser(name: string): Promise<void>
  loadAdminUsage(unit: UsageUnit, from?: number, to?: number, conversationId?: string): Promise<void>
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
  admin: AdminClient
  /** Текущий пользователь — его владелец sessionStore. */
  currentUser: () => SessionUser | null
  /** Сколько бесед у текущего пользователя (персональная карточка). */
  ownConversationCount: () => number
  fail?: (err: unknown, retry?: () => void) => void
  notify?: (notice: { kind: 'error' | 'success' | 'info'; text: string }) => void
}

function initialState(): AdminState {
  return {
    usersOpen: false,
    adminUsers: [],
    adminUsageSummary: [],
    adminUsersStatus: 'loading',
    adminUsersError: null,
    adminSelected: null,
    adminUsage: null,
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
  const client = deps.admin
  const core = createStoreCore<AdminState>(initialState())
  const { getState, setState } = core
  const fail = deps.fail ?? (() => {})

  async function refreshAdminUsers(): Promise<void> {
    if (!client['admin:users']) return
    setState({ adminUsersStatus: 'loading', adminUsersError: null })
    try {
      const [adminUsers, adminUsageSummary] = await Promise.all([
        client['admin:users'](),
        client['admin:usageSummary']()
      ])
      setState({ adminUsers, adminUsageSummary, adminUsersStatus: 'ready', adminUsersError: null })
    } catch (err) {
      setState({
        adminUsersStatus: 'error',
        adminUsersError: err instanceof Error ? err.message : String(err)
      })
      throw err
    }
  }

  async function refreshAdminLlmEngines(): Promise<void> {
    if (!client['admin:llmEngines']) return
    setState({ adminLlmEnginesStatus: 'loading', adminLlmEnginesError: null })
    try {
      setState({
        adminLlmEngines: await client['admin:llmEngines'](),
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
    if (!client['admin:modelPrices']) return
    try {
      setState({ adminModelPrices: await client['admin:modelPrices']() })
    } catch (err) {
      fail(err, () => void refreshAdminModelPrices())
    }
  }

  function closeUsers(): void {
    setState({
      usersOpen: false,
      adminSelected: null,
      adminUsage: null,
      adminConversations: [],
      adminMessages: [],
      adminConversationId: null,
      adminLlmEngineHealth: {}
    })
  }

  async function selectAdminUser(name: string): Promise<void> {
    setState({
      adminSelected: name,
      adminUsage: null,
      adminConversations: [],
      adminMessages: [],
      adminConversationId: null,
      adminUserLlmAccess: []
    })
    try {
      const user = deps.currentUser()
      const mine = user?.role !== 'admin'
      if (mine && name !== user?.name) return
      const [usage, conversations, access] = await Promise.all(
        mine
          ? [client['usage:report']({ unit: 'day' }), client['conversations:list']({ includeCompleted: true }), client['llm:access']()]
          : [client['admin:usage']({ name, unit: 'day' }), client['admin:conversations']({ name }), client['admin:llmAccess']({ name })]
      )
      setState({ adminUsage: usage, adminConversations: conversations, adminUserLlmAccess: access })
    } catch (err) {
      fail(err, () => void selectAdminUser(name))
    }
  }

  async function openUsers(): Promise<void> {
    setState({ usersOpen: true })
    try {
      const user = deps.currentUser()
      // Персональная страница — только для заведомо не-админа. Пока пользователь
      // неизвестен, остаётся прежнее админское поведение.
      if (user && user.role !== 'admin') {
        setState({
          adminUsers: [
            {
              name: user.name,
              role: 'developer',
              blocked: false,
              createdAt: 0,
              conversationCount: deps.ownConversationCount(),
              agents: []
            }
          ],
          adminUsageSummary: []
        })
        await selectAdminUser(user.name)
      } else {
        await Promise.all([refreshAdminUsers(), refreshAdminLlmEngines(), refreshAdminModelPrices()])
      }
    } catch (err) {
      fail(err, () => void openUsers())
    }
  }

  async function loadAdminUserLlmAccess(name = getState().adminSelected ?? ''): Promise<void> {
    if (!name) return
    try {
      setState({ adminUserLlmAccess: await client['admin:llmAccess']({ name }) })
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
      setState({ adminUsage: await client['admin:usage']({ name, unit, from, to, conversationId }) })
    } catch (err) {
      fail(err, () => void loadAdminUsage(unit, from, to, conversationId))
    }
  }

  async function openAdminConversation(conversationId: string): Promise<void> {
    const name = getState().adminSelected
    if (!name) return
    setState({ adminConversationId: conversationId, adminMessages: [] })
    try {
      setState({ adminMessages: await client['admin:messages']({ name, conversationId }) })
    } catch (err) {
      fail(err, () => void openAdminConversation(conversationId))
    }
  }

  async function saveAdminUserLlmAccess(access: UserLlmAccess[]): Promise<void> {
    const name = getState().adminSelected
    if (!name) return
    try {
      setState({ adminUserLlmAccess: await client['admin:saveLlmAccess']({ name, access }) })
      deps.notify?.({ kind: 'success', text: 'Доступ к моделям сохранён' })
    } catch (err) {
      fail(err, () => void saveAdminUserLlmAccess(access))
    }
  }

  async function checkAdminLlmEngineHealth(id: string): Promise<void> {
    try {
      const health = await client['admin:checkLlmEngineHealth']({ id })
      setState({ adminLlmEngineHealth: { ...getState().adminLlmEngineHealth, [id]: health } })
    } catch (err) {
      fail(err, () => void checkAdminLlmEngineHealth(id))
    }
  }

  async function setUserBlocked(name: string, blocked: boolean): Promise<void> {
    try {
      await client['admin:setBlocked']({ name, blocked })
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
          await client['admin:createUser']({ name, password, role })
          await refreshAdminUsers()
        } catch (err) {
          fail(err)
        }
      },
      setUserBlocked,
      async deleteUserAccount(name) {
        try {
          await client['admin:deleteUser']({ name })
          if (getState().adminSelected === name) closeUsers()
          await refreshAdminUsers()
        } catch (err) {
          fail(err)
        }
      },
      selectAdminUser,
      loadAdminUsage,
      openAdminConversation,
      refreshAdminLlmEngines,
      refreshAdminModelPrices,
      async saveAdminModelPrice(input) {
        try {
          await client['admin:saveModelPrice'](input)
          await refreshAdminModelPrices()
        } catch (err) {
          fail(err)
        }
      },
      async deleteAdminModelPrice(provider, model) {
        try {
          await client['admin:deleteModelPrice']({ provider, model })
          await refreshAdminModelPrices()
        } catch (err) {
          fail(err)
        }
      },
      async createAdminLlmEngine(input) {
        try {
          await client['admin:createLlmEngine'](input)
          await refreshAdminLlmEngines()
        } catch (err) {
          fail(err)
        }
      },
      async updateAdminLlmEngine(id, patch) {
        try {
          await client['admin:updateLlmEngine']({ id, patch })
          await refreshAdminLlmEngines()
        } catch (err) {
          fail(err)
        }
      },
      async deleteAdminLlmEngine(id) {
        try {
          await client['admin:deleteLlmEngine']({ id })
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

