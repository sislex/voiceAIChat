import { describe, expect, it } from 'vitest'
import type { CiLogLine } from '@shared/ci'
import { mergeCiLogLines } from './voiceStore'

const line = (seq: number, chunk = String(seq)): CiLogLine => ({
  runId: 'run-1', stepId: 'step-1', seq, stream: 'stdout', chunk, at: seq
})

describe('voiceStore — техническая лента', () => {
  it('объединяет серверную историю и live-события по seq без дублей и в правильном порядке', () => {
    expect(mergeCiLogLines([line(2, 'live')], [line(1, 'history'), line(2, 'duplicate')])).toEqual([
      line(1, 'history'),
      line(2, 'duplicate')
    ])
  })

  it('повторный realtime-кадр не добавляет вторую строку', () => {
    expect(mergeCiLogLines([line(1)], [line(1)])).toHaveLength(1)
  })
})
