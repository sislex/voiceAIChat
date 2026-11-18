import { describe, expect, it } from 'vitest'
import type { TurnMeta } from '@voicechat/shared'
import { createClaudeSink } from './sinks.js'

const assistant = (id: string, input: number, cacheRead: number, cacheCreation: number) => JSON.stringify({
  type: 'assistant',
  message: { id, content: [], usage: { input_tokens: input, output_tokens: 5, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreation } }
})

describe('createClaudeSink', () => {
  it('reports the input of the last model call beside the cumulative result usage', async () => {
    let meta: TurnMeta | undefined
    const sink = createClaudeSink({
      onSession: async () => {}, onDelta: async () => {}, onError: async () => {},
      onDone: async (_text, value) => { meta = value }
    })
    await sink.line(assistant('m1', 2, 31_000, 1_000))
    await sink.line(assistant('m2', 2, 32_000, 4_000))
    await sink.line(assistant('m3', 2, 36_000, 3_000))
    await sink.line(JSON.stringify({
      type: 'result', subtype: 'success', result: 'ok', session_id: 's', num_turns: 3,
      usage: { input_tokens: 6, output_tokens: 15, cache_read_input_tokens: 99_000, cache_creation_input_tokens: 8_000 }
    }))
    expect(meta?.contextInputTokens).toBe(39_002)
    expect((meta?.inputTokens ?? 0) + (meta?.cacheReadTokens ?? 0) + (meta?.cacheCreationTokens ?? 0)).toBe(107_006)
  })
})
