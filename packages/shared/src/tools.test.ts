import { describe, it, expect } from 'vitest'
import { parseToolBlock, toolBlock, detectOpenUtility, toolHint } from './tools'
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

  it('сохраняет путь для проводника или cwd терминала', () => {
    const res = parseToolBlock(toolBlock({ kind: 'explorer', agentId: 'm1', path: '/tmp/a.png' }))
    expect(res?.tool).toEqual({ kind: 'explorer', agentId: 'm1', path: '/tmp/a.png' })
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

describe('панель кода как третий вид утилиты', () => {
  it('блок модели с kind git распознаётся, а неизвестный вид — нет', () => {
    expect(parseToolBlock('текст\n```tool\n{"kind":"git"}\n```')?.tool).toEqual({ kind: 'git' })
    expect(parseToolBlock('```tool\n{"kind":"database"}\n```')).toBeNull()
  })

  it('цель рабочей копии из блока модели не читается: подставляет её приложение', () => {
    const parsed = parseToolBlock('```tool\n{"kind":"git","gitTarget":{"projectId":"чужой"}}\n```')
    expect(parsed?.tool).toEqual({ kind: 'git' })
    expect(parsed?.tool).not.toHaveProperty('gitTarget')
  })

  it('подсказка перечисляет все включённые виды', () => {
    expect(toolHint(['git'])).toContain('панель кода')
    expect(toolHint(['console', 'explorer', 'git'])).toContain('"kind": "git"')
    expect(toolHint([])).toBe('')
  })

  it('«покажи изменения» и «открой код» открывают панель кода', () => {
    expect(detectOpenUtility('покажи изменения')?.kind).toBe('git')
    expect(detectOpenUtility('открой код')?.kind).toBe('git')
    expect(detectOpenUtility('открой git')?.kind).toBe('git')
    expect(detectOpenUtility('открой консоль')?.kind).toBe('console')
    expect(detectOpenUtility('открой проводник')?.kind).toBe('explorer')
  })
})
