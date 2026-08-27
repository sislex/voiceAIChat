import type {
  AdminLlmEngine, AdminLlmEngineHealth, AdminLlmEngineInput, AdminUserInfo,
  ModelPrice, ModelPriceInput, UsageReport, UsageUnit, UserUsageSummary, AdminMakeStats, SecurityEvent, InviteInfo } from '@shared/admin'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { Conversation, Message, SessionInfo, SessionUser, UserRole } from '@shared/types'

export interface AdminClient {
  listUsers(): Promise<AdminUserInfo[]>
  usageSummary(range?: { from?: number; to?: number }): Promise<UserUsageSummary[]>
  /** Метрики Make (п.38); у старых клиентов метода может не быть — стор это переживает. */
  makeStats?(): Promise<AdminMakeStats>
  /** Сессии пользователя и отзыв (auth-roadmap п.4); у старых клиентов может не быть. */
  userSessions?(input: { name: string }): Promise<SessionInfo[]>
  revokeSession?(input: { sid: string }): Promise<void>
  /** Журнал безопасности (auth-roadmap п.7). */
  securityEvents?(input: { user?: string; limit?: number }): Promise<SecurityEvent[]>
  /** Инвайты на саморегистрацию (auth-roadmap п.8). */
  listInvites?(): Promise<InviteInfo[]>
  createInvite?(input: { role: UserRole; ttlHours?: number; maxUses?: number; note?: string }): Promise<InviteInfo>
  deleteInvite?(input: { token: string }): Promise<void>
  createUser(input: { name: string; password: string; role: UserRole }): Promise<AdminUserInfo>
  updateUserRole(input: { name: string; role: UserRole }): Promise<AdminUserInfo>
  setUserBlocked(input: { name: string; blocked: boolean }): Promise<void>
  deleteUser(input: { name: string }): Promise<void>
  getUserLlmAccess(input: { name: string }): Promise<UserLlmAccess[]>
  replaceUserLlmAccess(input: { name: string; access: UserLlmAccess[] }): Promise<UserLlmAccess[]>
  userUsage(input: { name: string; unit: UsageUnit; from?: number; to?: number; conversationId?: string }): Promise<UsageReport>
  userConversations(input: { name: string }): Promise<Conversation[]>
  userMessages(input: { name: string; conversationId: string }): Promise<Message[]>
  listLlmEngines(): Promise<AdminLlmEngine[]>
  createLlmEngine(input: AdminLlmEngineInput): Promise<AdminLlmEngine>
  updateLlmEngine(input: { id: string; patch: AdminLlmEngineInput }): Promise<AdminLlmEngine>
  deleteLlmEngine(input: { id: string }): Promise<void>
  checkLlmEngineHealth(input: { id: string }): Promise<AdminLlmEngineHealth>
  listModelPrices(): Promise<ModelPrice[]>
  saveModelPrice(input: ModelPriceInput): Promise<ModelPrice>
  deleteModelPrice(input: { provider: string; model: string }): Promise<void>
}
export interface SessionPort {
  currentUser(): SessionUser | null
  refreshSession(): Promise<SessionUser | null>
  refreshOwnLlmAccess(): Promise<void>
  onAdminAccessLost?(): void
}
export interface OperationsPort { readonly: true }
export interface AdminNavigationModel { hash: string; navigate(hash: string): void; deny(): void }
export interface AdminDependencies {
  client: AdminClient
  session: SessionPort
  navigation: AdminNavigationModel
  operations?: OperationsPort
  notify?(notice: { kind: 'error' | 'success' | 'info'; text: string }): void
  fail?(error: unknown, retry?: () => void): void
}
