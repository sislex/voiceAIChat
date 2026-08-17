import type { CliLoginStatus, LoginStatusMap, LlmProvider } from '@voicechat/shared'

export type AuthStatusLoader = (userId: string) => Promise<LoginStatusMap>
type Listener = (status: LoginStatusMap, userId: string) => void

const AUTH_FAILURE = /вход в (Claude|Codex) не выполнен|требуется повторный вход|not logged in|authentication required|unauthorized|oauth session expired|invalid credentials|(?:HTTP )?(?:401|403)\b/i

/** Per-user источник истины для HTTP и WebSocket. */
export class AuthStatusState {
  private readonly statuses = new Map<string, LoginStatusMap>()
  private readonly pending = new Map<string, Promise<LoginStatusMap>>()
  private readonly listeners = new Set<Listener>()

  constructor(private readonly load: AuthStatusLoader) {}

  async get(userId: string, refresh = false): Promise<LoginStatusMap> {
    const cached = this.statuses.get(userId)
    if (cached && !refresh) return cached
    const active = this.pending.get(userId)
    if (active) return active
    const request = this.load(userId).then((status) => {
      this.set(userId, status)
      return this.statuses.get(userId)!
    }).finally(() => this.pending.delete(userId))
    this.pending.set(userId, request)
    return request
  }

  set(userId: string, status: LoginStatusMap): boolean {
    const previous = this.statuses.get(userId)
    if (previous && JSON.stringify(previous) === JSON.stringify(status)) return false
    this.statuses.set(userId, status)
    for (const listener of [...this.listeners]) listener(status, userId)
    return true
  }

  reportRunError(userId: string, provider: LlmProvider, message: string): boolean {
    if (!AUTH_FAILURE.test(message)) return false
    const current = this.statuses.get(userId)
    if (!current) return false
    const next: CliLoginStatus = {
      provider,
      loggedIn: false,
      detail: provider === 'claude'
        ? 'требуется повторный вход — выполните `claude login`'
        : 'вход не выполнен — выполните `codex login`'
    }
    return this.set(userId, { ...current, [provider]: next })
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
