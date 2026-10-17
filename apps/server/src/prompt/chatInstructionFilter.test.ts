import { describe, expect, it } from 'vitest'
import { DEFAULT_CHAT_INSTRUCTIONS } from '@voicechat/shared'
import { kanbanAutopilot, turnChatInstructions } from './chatInstructionFilter.js'

const kinds = (items: ReturnType<typeof turnChatInstructions>): Array<string | undefined> => items.map((item) => item.kind)

describe('turnChatInstructions', () => {
  it('drops task-launch only for a Kanban turn with autopilot on', () => {
    expect(kinds(turnChatInstructions(DEFAULT_CHAT_INSTRUCTIONS, { assistantKind: 'kanban', assistantAutonomy: 'auto' }, true))).not.toContain('taskLaunch')
    expect(kinds(turnChatInstructions(DEFAULT_CHAT_INSTRUCTIONS, { assistantKind: 'kanban', assistantAutonomy: 'confirm' }, true))).toContain('taskLaunch')
    // The same conversation outside the assistant panel is an ordinary chat turn.
    expect(kinds(turnChatInstructions(DEFAULT_CHAT_INSTRUCTIONS, { assistantKind: 'kanban', assistantAutonomy: 'auto' }, false))).toContain('taskLaunch')
    expect(kinds(turnChatInstructions(DEFAULT_CHAT_INSTRUCTIONS, null, false))).toContain('taskLaunch')
  })

  it('keeps the per-kind filter', () => {
    expect(kinds(turnChatInstructions(DEFAULT_CHAT_INSTRUCTIONS, { assistantKind: 'make' }, false))).not.toContain('taskLaunch')
  })

  it('treats a missing autonomy as autopilot, like the repository', () => {
    expect(kanbanAutopilot({})).toBe(true)
    expect(kanbanAutopilot({ assistantAutonomy: 'confirm' })).toBe(false)
  })
})
