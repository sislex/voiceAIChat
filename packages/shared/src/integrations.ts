/** Board-owned snapshot; Core forwards it without deriving board state. */
export interface BoardCardsSnapshot {
  /** Unix timestamp in milliseconds. */
  generatedAt: number
  tasks: {
    id: string
    seq: number
    key: string
    title: string
    column: { id: string; name: string; semanticType: string }
    autoPilot: boolean
    autoPilotFixCycles: number
    /** Unix timestamp in milliseconds. */
    updatedAt: number
    labels: string[]
    development: {
      runId: string
      status: string
      /** Unix timestamps in milliseconds; null before starting/finishing. */
      startedAt: number | null
      finishedAt: number | null
      failedStep: {
        title: string
        exitCode: number | null
        /** Last at most 40 lines, redacted by the board service before publication. */
        tail: string
      } | null
    } | null
    qa: { stage: string; status: string; failedSummary: string | null }[]
    merge: { runId: string; status: string; targetBranch: string; failedSummary: string | null } | null
    decisionReason: string | null
  }[]
}
