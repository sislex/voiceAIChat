import { z } from 'zod'
import { STAND_DELIVERY_ERROR_CODES, type StandDelivery } from '@voicechat/shared'
import { projectModeError } from './projectAdapters.js'

export interface StandDeliveryIntegration { url: string; token: string }
/** Project-scoped outbound operator credentials, distinct from hashed inbound Core tokens. */
export function standDeliveryIntegration(project: string): StandDeliveryIntegration | undefined {
  const raw = process.env.VC_STAND_DELIVERY_PROJECTS
  if (!raw) return undefined
  try {
    const settings = z.record(z.string(), z.object({ url: z.string().url(), token: z.string().min(1) })).parse(JSON.parse(raw))
    return settings[project]
  } catch { projectModeError(503, 'stand_delivery_configuration_invalid') }
}

const submission = z.object({
  repository: z.string(), branch: z.string(), targetBranch: z.literal('dev'),
  headSha: z.string(), title: z.string(), author: z.string()
})
export type StandDeliverySubmission = z.infer<typeof submission>
const task = z.object({
  runId: z.string().optional(), taskId: z.string(),
  state: z.string().optional(), status: z.string().optional(),
  createdAt: z.string().optional(), gateLogTail: z.string().optional(),
  candidate: submission.extend({ createdAt: z.string().optional() }).optional(),
  integrationStatus: z.string().optional(),
  attempts: z.array(z.object({ status: z.string().optional(), integrationStatus: z.string().optional(), gateLogTail: z.string().optional() })).optional()
}).passthrough()
const status = z.object({
  tasks: z.array(task).optional(),
  runs: z.array(z.object({ runId: z.string(), tasks: z.array(task) })).optional(),
  candidates: z.array(submission.extend({ runId: z.string(), taskId: z.string(), createdAt: z.string(), state: z.string().optional() })).optional(),
  events: z.array(z.object({ type: z.string(), runId: z.string(), taskId: z.string(), gateLogTail: z.string().optional() })).optional()
}).refine(value => value.tasks || value.runs || value.candidates)

const states: Record<string, StandDelivery['state'] | undefined> = {
  submitted: 'submitted', pending: 'submitted', queued: 'submitted',
  gating: 'gating', integrating: 'gating', integration_running: 'gating',
  integrated: 'integrated', integration_integrated: 'integrated',
  rejected: 'rejected', integration_failed: 'rejected', failed: 'rejected'
}

/** Status contains persisted branch candidates, so history also survives a Core restart. */
export function coordinatorDeliveries(value: unknown, repository: string, branch: string): StandDelivery[] {
  const parsed = status.safeParse(value)
  if (!parsed.success) projectModeError(502, 'invalid_delivery_status')
  const data = parsed.data
  const tasks = [...(data.tasks ?? []), ...(data.runs ?? []).flatMap(run => run.tasks.map(task => ({ ...task, runId: run.runId })))]
  const candidates = [...(data.candidates ?? []), ...tasks.flatMap(task => task.candidate && task.runId ? [{
    ...task.candidate, runId: task.runId, taskId: task.taskId,
    createdAt: task.candidate.createdAt ?? task.createdAt ?? '', state: task.state ?? task.status
  }] : [])]
  const deliveries = new Map<string, StandDelivery>()
  for (const candidate of candidates) {
    if (candidate.repository.toLowerCase() !== repository.toLowerCase() || candidate.branch !== branch) continue
    const current = tasks.find(task => task.runId === candidate.runId && task.taskId === candidate.taskId)
    const attempt = current?.attempts?.at(-1)
    let state = states[attempt?.integrationStatus ?? current?.integrationStatus ?? attempt?.status ?? current?.state ?? current?.status ?? candidate.state ?? 'submitted']
    let gateLogTail = attempt?.gateLogTail ?? current?.gateLogTail
    for (const event of data.events ?? []) {
      if (event.runId !== candidate.runId || event.taskId !== candidate.taskId) continue
      const eventState = event.type === 'candidate.branch_submitted' ? 'submitted' : states[event.type.replace(/^attempt\./, '')]
      if (eventState && (eventState !== 'submitted' || !state)) state = eventState
      gateLogTail = event.gateLogTail ?? gateLogTail
    }
    if (!state) projectModeError(502, 'invalid_delivery_state')
    deliveries.set(candidate.runId + ':' + candidate.taskId, {
      ...submission.parse(candidate), runId: candidate.runId, taskId: candidate.taskId,
      createdAt: candidate.createdAt, state,
      ...(gateLogTail ? { gateLogTail: gateLogTail.slice(-16_384) } : {})
    })
  }
  return [...deliveries.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
}

const refusal = z.object({ error: z.enum(STAND_DELIVERY_ERROR_CODES) }).strict()
const refusalBodyLimit = 4 * 1024

/** Bound retained bytes and stop reading at the cap; never expose upstream diagnostics. */
async function coordinatorRefusal(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader()
  if (!reader) return undefined
  const bytes = new Uint8Array(refusalBodyLimit)
  let size = 0
  try {
    while (size < refusalBodyLimit) {
      const { done, value } = await reader.read()
      if (done) {
        const parsed = refusal.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))))
        return parsed.success ? parsed.data.error : undefined
      }
      if (value.byteLength >= refusalBodyLimit - size) return undefined
      bytes.set(value, size)
      size += value.byteLength
    }
  } catch {
    // Invalid, interrupted or oversized bodies retain the generic failure.
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return undefined
}

export class StandDeliveryCoordinator {
  private cache = new Map<string, { expires: number; value: unknown }>()
  constructor(private readonly integration = standDeliveryIntegration, private readonly fetchImpl: typeof fetch = fetch) {}

  private async request(project: string, path: string, body?: unknown) {
    const settings = this.integration(project)
    if (!settings) projectModeError(503, 'stand_delivery_unconfigured')
    const url = new URL(settings.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) projectModeError(503, 'stand_delivery_configuration_invalid')
    let response: Response
    try {
      response = await this.fetchImpl(settings.url.replace(/\/$/, '') + path, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(25_000),
        headers: { authorization: 'Bearer ' + settings.token, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
    } catch { projectModeError(503, 'stand_delivery_unavailable') }
    if (!response.ok) {
      const code = await coordinatorRefusal(response)
      if (code && [400, 403, 409, 503].includes(response.status)) projectModeError(response.status, code)
      projectModeError(response.status === 409 ? 409 : 502, 'stand_delivery_request_failed')
    }
    try { return await response.json() as unknown } catch { projectModeError(502, 'invalid_delivery_response') }
  }

  async submit(project: string, body: StandDeliverySubmission) {
    const response = await this.request(project, '/v1/candidates/branch', body)
    const result = z.object({ runId: z.string().min(1), taskId: z.string().min(1) }).safeParse(response)
    if (!result.success) projectModeError(502, 'invalid_delivery_response')
    this.cache.delete(project)
    return result.data
  }

  async list(project: string, repository: string, branch: string): Promise<StandDelivery[]> {
    const cached = this.cache.get(project)
    if (cached && cached.expires > Date.now()) return coordinatorDeliveries(cached.value, repository, branch)
    const value = await this.request(project, '/v1/status')
    const result = coordinatorDeliveries(value, repository, branch)
    this.cache.set(project, { value, expires: Date.now() + 10_000 })
    return result
  }
}
