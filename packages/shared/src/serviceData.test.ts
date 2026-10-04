import { describe, expect, it } from 'vitest'
import type { TurnMeta } from './types'
import { stripServiceData } from './serviceData'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

describe('stripServiceData', () => {
  it('removes activity and request bodies and records their serialized sizes', () => {
    const activity = [{ kind: 'thinking' as const, summary: 'Обдумываю', raw: '{"type":"thinking"}' }]
    const request = {
      provider: 'claude' as const,
      model: 'sonnet',
      prompt: 'Большой запрос',
      promptChars: 14,
      permissionMode: 'default',
      resumed: false,
      tools: ['Read'],
      kbContext: {
        confidence: 'high' as const,
        sections: [{ documentId: 'doc', title: 'Title', heading: 'Head', sourcePath: 'kb.md', anchor: 'head', chars: 12 }]
      }
    }
    const stripped = stripServiceData({ activity, request })

    expect(stripped.activity).toBeUndefined()
    expect(stripped.request).toEqual({
      model: 'sonnet', permissionMode: 'default', promptChars: 14,
      kbContext: { confidence: 'high', sections: [{ documentId: 'doc', title: 'Title', heading: 'Head',
        sourcePath: 'kb.md', anchor: 'head', chars: 12 }] }
    })
    expect(stripped.serviceData).toEqual({
      activityEntries: 1,
      activityBytes: bytes(activity),
      requestBytes: bytes(request)
    })
  })

  it('is idempotent', () => {
    const once = stripServiceData({
      activity: [{ kind: 'result', summary: 'done', raw: '{"type":"result"}' }],
      request: { provider: 'codex', model: 'gpt', prompt: 'hello', promptChars: 5, resumed: false }
    })
    expect(stripServiceData(once)).toBe(once)
  })

  it('returns metadata without service data unchanged', () => {
    const meta: TurnMeta = { durationMs: 42 }
    expect(stripServiceData(meta)).toBe(meta)
    expect(meta.serviceData).toBeUndefined()
  })
})
