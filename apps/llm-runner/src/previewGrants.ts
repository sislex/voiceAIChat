import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { LlmRunBody, PreviewCliGrantScope } from '@voicechat/shared'

interface Grant {
  id: string
  scope: PreviewCliGrantScope
  expiresAt: number
  active: Set<string>
}
/** Tokens are opaque and hashed at rest. Restart revokes every grant. */
export class PreviewCliGrants {
  private grants = new Map<string, Grant>()
  constructor(private readonly cancel: (id: string) => unknown, private readonly now = Date.now) {}
  issue(value: PreviewCliGrantScope): { id: string; token: string; expiresAt: number } {
    if (!value || !['projectId', 'taskId', 'runId', 'userId'].every((key) => {
      const v = value[key as keyof PreviewCliGrantScope]
      return typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v)
    }) || !['claude', 'codex'].includes(value.kind) || typeof value.model !== 'string' || value.model.length > 100 ||
      !Number.isInteger(value.ttlMs) || value.ttlMs < 1000 || value.ttlMs > 7200000 ||
      JSON.stringify(value.operations) !== '["generate"]') throw new Error('invalid_preview_scope')
    // Codex currently lacks a verified tool-free invocation in this runner. Never fall back to prompt-only restrictions.
    if (value.kind === 'codex') throw new Error('preview_text_only_unavailable')
    this.sweep()
    if (this.grants.size >= 1000) throw new Error('preview_grant_capacity')
    const token = randomBytes(32).toString('base64url'), id = randomUUID()
    const expiresAt = this.now() + value.ttlMs
    this.grants.set(this.hash(token), { id, scope: structuredClone(value), expiresAt, active: new Set() })
    return { id, token, expiresAt }
  }
  private hash(token: string): string { return createHash('sha256').update(token).digest('hex') }
  private get(token: string | undefined): Grant | undefined {
    this.sweep()
    return token ? this.grants.get(this.hash(token)) : undefined
  }
  accepts(token: string | undefined): boolean { return !!this.get(token) }
  prepare(token: string | undefined, input: unknown): LlmRunBody | null {
    const grant = this.get(token)
    if (!grant || grant.active.size >= 2 || !input || typeof input !== 'object') return null
    const raw = input as Record<string, unknown>
    if (Object.keys(raw).some((key) => !['prompt', 'kind', 'model', 'sessionId'].includes(key)) ||
      typeof raw.prompt !== 'string' || !raw.prompt.trim() || raw.prompt.length > 64000 ||
      (raw.kind !== undefined && raw.kind !== grant.scope.kind) ||
      (raw.model !== undefined && raw.model !== grant.scope.model) ||
      (raw.sessionId !== undefined && raw.sessionId !== null)) return null
    const runId = 'preview-' + randomUUID()
    grant.active.add(runId)
    return {
      runId, prompt: raw.prompt, sessionId: null, userId: grant.scope.userId,
      kind: grant.scope.kind, model: grant.scope.model, executionDisabled: true, textOnly: true
    }
  }
  finish(token: string | undefined, runId: string): void { this.get(token)?.active.delete(runId) }
  revoke(id: string): void {
    for (const [key, grant] of this.grants) if (grant.id === id) {
      this.grants.delete(key)
      for (const active of grant.active) this.cancel(active)
    }
  }
  sweep(): void {
    for (const grant of this.grants.values()) if (grant.expiresAt <= this.now()) this.revoke(grant.id)
  }
  close(): void { for (const grant of this.grants.values()) this.revoke(grant.id) }
}
