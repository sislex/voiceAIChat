// Task-run design-read capabilities for Make. CI and task preparation receive
// /mcp/make?...&scope=<token> URLs allowing make_* tools to list and read only selected files.
// Tokens are HMAC-signed documents with a TTL, issued by core and verified by Make without shared
// process memory. Their claims still require checking against current task_designs, the
// conversation's project, and user membership; see mcp/makeMcp.ts.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { taskMakeSources, type LlmMakeSource, type TaskDesignLink } from '@voicechat/shared'

export interface MakeTaskScopeSource {
  conversationId: string
  title: string
  mode: 'whole_project' | 'files'
  paths: string[]
}

export interface MakeTaskScope {
  userId: string
  projectId: string
  taskId: string
  sources: MakeTaskScopeSource[]
  expiresAt: number
}

export const TASK_SCOPE_TTL_MS = 30 * 60_000

const sign = (secret: string, payload: string): string => createHmac('sha256', secret).update(payload).digest('base64url')

export function signTaskScope(secret: string, entry: Omit<MakeTaskScope, 'expiresAt'>, opts: { ttlMs?: number; now?: number } = {}): string {
  const scope: MakeTaskScope = { ...entry, expiresAt: (opts.now ?? Date.now()) + (opts.ttlMs ?? TASK_SCOPE_TTL_MS) }
  const payload = Buffer.from(JSON.stringify(scope), 'utf8').toString('base64url')
  return `${payload}.${sign(secret, payload)}`
}

/** Return null for a signature mismatch, corrupt document, or expired token. */
export function verifyTaskScope(secret: string, token: string, now = Date.now()): MakeTaskScope | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const expected = Buffer.from(sign(secret, payload))
  const actual = Buffer.from(token.slice(dot + 1))
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  let scope: MakeTaskScope
  try { scope = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as MakeTaskScope } catch { return null }
  if (typeof scope?.userId !== 'string' || typeof scope.projectId !== 'string' || typeof scope.taskId !== 'string' || !Array.isArray(scope.sources)) return null
  if (typeof scope.expiresAt !== 'number' || scope.expiresAt <= now) return null
  return scope
}

export interface TaskMakeSourcesArgs {
  designs: TaskDesignLink[]
  userId: string
  projectId: string
  taskId: string
}

/** Make sources for an LLM request: one scope token covers all task designs, with a separate conv value in each URL. */
export function buildTaskMakeSources(args: TaskMakeSourcesArgs & { baseUrl?: string; secret?: string; now?: number }): LlmMakeSource[] {
  if (!args.baseUrl || !args.secret) return []
  const sources = taskMakeSources(args.designs)
  if (!sources.length) return []
  const token = signTaskScope(args.secret, {
    userId: args.userId, projectId: args.projectId, taskId: args.taskId,
    sources: sources.map(({ conversationId, title, mode, paths }) => ({ conversationId, title, mode, paths }))
  }, { now: args.now })
  return sources.map((source) => ({
    name: source.name,
    conversationId: source.conversationId,
    mode: source.mode,
    paths: source.paths,
    mcpUrl: `${args.baseUrl}&conv=${encodeURIComponent(source.conversationId)}&scope=${encodeURIComponent(token)}`
  }))
}
