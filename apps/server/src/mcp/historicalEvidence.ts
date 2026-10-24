import { createHash } from 'node:crypto'

/** Supplied only by the existing run authority, never by tool arguments. */
export interface HistoricalEvidenceGrant {
  userId: string
  projectId: string
  taskId: string
  runId: string
  agentId: string
  cwd: string
  expiresAt: number
  journals: ReadonlyArray<{ commandId: string; sourceId: string; expectedSha256: string }>
}

export interface HistoricalEvidencePort {
  /** Resolve an existing active run capability and its current journal permissions.
   * Must reject revoked/finished runs; this interface cannot issue grants.
   */
  resolveRun(token: string): Promise<HistoricalEvidenceGrant | undefined>
  /** Read original bytes from an explicitly commissioned immutable source.
   * No path discovery, credentials, copies, normalization or filesystem fallback.
   * undefined means the authorized source is not connected/available.
   */
  readJournal(grant: HistoricalEvidenceGrant, sourceId: string): Promise<AsyncIterable<Uint8Array> | undefined>
}

export interface HistoricalEvidenceContext {
  token?: string
  projectId?: string
  agentId: string
  cwd?: string
}

const MAX_BYTES = 8 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/

/** Hash-only disclosure: original bytes and source identifiers never leave this service. */
export class HistoricalEvidence {
  constructor(
    private readonly port: HistoricalEvidencePort,
    private readonly canAccessProject: (userId: string, projectId: string) => Promise<boolean>,
    private readonly now: () => number = Date.now
  ) {}

  async verify(context: HistoricalEvidenceContext, commandId: string) {
    try {
      const authorize = async () => {
        if (!context.token || !context.projectId || !context.cwd || !UUID.test(commandId)) return undefined
        const grant = await this.port.resolveRun(context.token)
        if (!grant || !grant.userId || !grant.taskId || !grant.runId ||
            !Number.isFinite(grant.expiresAt) || grant.expiresAt <= this.now() ||
            grant.projectId !== context.projectId || grant.agentId !== context.agentId ||
            grant.cwd !== context.cwd ||
            !(await this.canAccessProject(grant.userId, grant.projectId))) return undefined
        const journals = grant.journals.filter(journal => journal.commandId === commandId)
        if (journals.length !== 1 || !journals[0].sourceId || !SHA256.test(journals[0].expectedSha256)) return undefined
        return { grant: structuredClone(grant), journal: { ...journals[0] } }
      }
      const before = await authorize()
      if (!before) return { status: 'denied' as const }
      // Keep the authorization snapshot separate from adapter-owned objects.
      const stream = await this.port.readJournal(structuredClone(before.grant), before.journal.sourceId)
      if (!stream) return { status: 'source_unavailable' as const }
      const hash = createHash('sha256')
      let bytes = 0
      for await (const chunk of stream) {
        if (!(chunk instanceof Uint8Array)) throw new Error('invalid source')
        bytes += chunk.byteLength
        if (bytes > MAX_BYTES) return { status: 'source_too_large' as const }
        hash.update(chunk)
      }
      const after = await authorize()
      if (!after || JSON.stringify(before) !== JSON.stringify(after)) return { status: 'denied' as const }
      const sha256 = hash.digest('hex')
      return {
        status: 'verified' as const,
        runId: before.grant.runId,
        commandId,
        bytes,
        sha256,
        expectedSha256: before.journal.expectedSha256,
        matches: sha256 === before.journal.expectedSha256,
        observedAt: new Date(this.now()).toISOString()
      }
    } catch {
      // Adapter errors may contain private paths, tokens or journal contents.
      return { status: 'source_unavailable' as const }
    }
  }
}
