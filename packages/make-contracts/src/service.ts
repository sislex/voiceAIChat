// Port describing what core needs from Make, complementing core.ts. Model turns need project
// context and pre-edit snapshot IDs; CI and task preparation need design-scope tokens; kanban
// routes need file lists for path validation; administration needs disk usage. Core accesses Make
// through this interface, with implementation composition in make/module.ts.

import type { AdminMakeStats, LlmMakeSource, MakeFileInfo, ServerMessage } from '@voicechat/shared'
import type { TaskMakeSourcesArgs } from './taskScope.js'

export interface MakeService {
  /** Design tokens and open project comments for the Make chat prompt; empty when no context is available. */
  promptContext(conversationId: string): Promise<string>
  /** Pre-edit assistant snapshot created during this turn, used as meta.makeSnapshotId. */
  turnSnapshot(turn: string): string | undefined
  listFiles(conversationId: string): Promise<MakeFileInfo[]>
  /** Make design sources for a task run: MCP URLs with scope tokens, or an empty list when Make MCP is not configured. */
  taskSources(args: TaskMakeSourcesArgs): LlmMakeSource[]
  adminStats(): Promise<AdminMakeStats>
  /** The same metrics in Prometheus format. */
  metrics(): Promise<string>
  sweep(): Promise<{ projects: number; snapshots: number; shots: number }>
  /** Subscribe a user's WS session to make.changed and make.presence frames. */
  subscribe(userId: string, sink: (m: ServerMessage) => void): () => void
}
