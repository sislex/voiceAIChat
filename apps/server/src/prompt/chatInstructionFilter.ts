// Chat instructions that actually reach a turn, after the per-kind filter.
//
// Shared `instructionsForAssistantKind` knows only the conversation kind. The
// Kanban assistant also depends on its «Автопилот» toggle: with autopilot on the
// owner asked it to act through mcp__kanban__* tools without asking first, so the
// task-launch rule («спроси разрешение перед изменением проекта») contradicts the
// mode and made the assistant stop before every operator action. With autopilot
// off the rule stays. Lives server-side so the turn (`turns.ts`) and the context
// inspector (`routes/rest.ts`) share it without a Shared archive release.

import type { ChatInstruction, Conversation } from '@voicechat/shared'
import { instructionsForAssistantKind } from '@voicechat/shared'

/** Whether the Kanban assistant applies its changes without confirmation. */
export function kanbanAutopilot(conversation: Pick<Conversation, 'assistantAutonomy'>): boolean {
  // The repository normalizes a missing value to `auto`; mirror that here.
  return (conversation.assistantAutonomy ?? 'auto') === 'auto'
}

export function turnChatInstructions(
  effective: readonly ChatInstruction[],
  conversation: Pick<Conversation, 'assistantKind' | 'assistantAutonomy'> | null | undefined,
  kanbanTurn: boolean
): ChatInstruction[] {
  const byKind = instructionsForAssistantKind(effective, conversation?.assistantKind ?? null)
  if (!kanbanTurn || !conversation || !kanbanAutopilot(conversation)) return byKind
  return byKind.filter((item) => item.kind !== 'taskLaunch')
}
