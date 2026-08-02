// Отмена команды должна снимать ВСЁ дерево процессов: отменённый CI-ран оставлял
// на машине живой `npm ci`/`claude`, потому что сигнал уходил только shell'у.

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { runCommand, cancelCommand } from './exec'
import type { AgentToServer } from '@voicechat/shared'

/** Живы ли процессы с такими pid. */
function alive(pids: number[]): number[] {
  return pids.filter((pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })
}

describe('cancelCommand', () => {
  it('убивает внука, а не только shell', async () => {
    const marker = `vc-exec-tree-${process.pid}`
    const done = new Promise<AgentToServer[]>((resolve) => {
      const msgs: AgentToServer[] = []
      // bash → sh -c → sleep: внук переживал старый kill('SIGTERM') по shell'у.
      runCommand('tree-1', `sh -c 'sleep 60 # ${marker}' & wait`, 30_000, (m) => {
        msgs.push(m)
        if (m.t === 'exec.done' || m.t === 'exec.error') resolve(msgs)
      })
    })
    // Дать дереву стартовать и найти pid внука по маркеру.
    let pids: number[] = []
    for (let i = 0; i < 50 && !pids.length; i++) {
      await new Promise((r) => setTimeout(r, 20))
      try {
        pids = execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' })
          .split('\n')
          .map((x) => Number(x.trim()))
          .filter((x) => Number.isFinite(x) && x > 0)
      } catch {
        pids = []
      }
    }
    expect(pids.length).toBeGreaterThan(0)

    cancelCommand('tree-1')
    await done
    // Дереву дают долететь до конца — проверяем, что через мгновение никого нет.
    for (let i = 0; i < 50 && alive(pids).length; i++) await new Promise((r) => setTimeout(r, 20))
    expect(alive(pids)).toEqual([])
  }, 20_000)
})
