import { describe, it, expect } from 'vitest'
import { runCommand, cancelCommand } from './exec'
import type { AgentToServer } from '@voicechat/shared'

/** Запускает команду и собирает все emit-сообщения до exec.done/exec.error. */
function collect(execId: string, command: string, timeoutMs: number): Promise<AgentToServer[]> {
  return new Promise((resolve) => {
    const msgs: AgentToServer[] = []
    runCommand(execId, command, timeoutMs, (m) => {
      msgs.push(m)
      if (m.t === 'exec.done' || m.t === 'exec.error') resolve(msgs)
    })
  })
}

describe('runCommand', () => {
  it('echo → chunk со stdout и exit 0', async () => {
    const msgs = await collect('e1', 'echo привет', 5000)
    const chunk = msgs.find((m) => m.t === 'exec.chunk')
    expect(chunk).toMatchObject({ t: 'exec.chunk', stream: 'stdout' })
    expect((chunk as { data: string }).data).toContain('привет')
    const done = msgs.find((m) => m.t === 'exec.done')
    expect(done).toMatchObject({ t: 'exec.done', exitCode: 0 })
  })

  it('ненулевой код выхода пробрасывается', async () => {
    const msgs = await collect('e2', 'exit 3', 5000)
    expect(msgs.find((m) => m.t === 'exec.done')).toMatchObject({ exitCode: 3 })
  })

  it('таймаут → SIGKILL и timedOut', async () => {
    const msgs = await collect('e3', 'sleep 60', 100)
    const done = msgs.find((m) => m.t === 'exec.done') as
      | { t: 'exec.done'; timedOut?: boolean }
      | undefined
    expect(done?.timedOut).toBe(true)
  })

  it('cancelCommand завершает долгую команду', async () => {
    const p = collect('e4', 'sleep 60', 60_000)
    // Дать процессу стартовать, затем отменить.
    await new Promise((r) => setTimeout(r, 100))
    cancelCommand('e4')
    const msgs = await p
    expect(msgs.some((m) => m.t === 'exec.done')).toBe(true)
  }, 10_000)
})
