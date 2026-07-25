import { describe, it, expect } from 'vitest'
import { parseToolBlock, toolBlock, detectOpenUtility } from './tools'
import type { AgentInfo } from './agentProtocol'

const agents: AgentInfo[] = [
  {
    id: 'm1',
    name: 'MacBook',
    online: true,
    createdAt: 1,
    lastSeen: null,
    policy: { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [] }
  }
]

describe('parseToolBlock', () => {
  it('извлекает kind/agentId и вырезает блок из текста', () => {
    const text = 'Открываю.\n\n' + toolBlock({ kind: 'console', agentId: 'm1' })
    const res = parseToolBlock(text)
    expect(res?.tool).toEqual({ kind: 'console', agentId: 'm1' })
    expect(res?.body).toBe('Открываю.')
  })

  it('нет блока / битый JSON / неизвестный kind → null', () => {
    expect(parseToolBlock('просто текст')).toBeNull()
    expect(parseToolBlock('```tool\n{битый}\n```')).toBeNull()
    expect(parseToolBlock('```tool\n{"kind":"foo"}\n```')).toBeNull()
  })
})

describe('detectOpenUtility', () => {
  it('распознаёт консоль и проводник', () => {
    expect(detectOpenUtility('открой консоль')).toEqual({ kind: 'console' })
    expect(detectOpenUtility('Открой проводник')).toEqual({ kind: 'explorer' })
    expect(detectOpenUtility('запусти терминал')).toEqual({ kind: 'console' })
    expect(detectOpenUtility('open files')).toEqual({ kind: 'explorer' })
  })

  it('резолвит машину по имени после команды', () => {
    expect(detectOpenUtility('открой консоль на macbook', agents)).toEqual({
      kind: 'console',
      agentId: 'm1'
    })
  })

  it('не-команда → null', () => {
    expect(detectOpenUtility('расскажи про консоль')).toBeNull()
    expect(detectOpenUtility('привет')).toBeNull()
  })
})
