import { describe, expect, it } from 'vitest'
import { EXTERNAL_TASK_COLUMN, type ExternalTaskState } from './projects'

describe('external task column mapping', () => {
  it.each<[ExternalTaskState, string]>([
    ['blocked', 'backlog'], ['ready', 'backlog'], ['running', 'development'],
    ['submitted', 'manual_qa'], ['done', 'done'], ['failed', 'decision_required']
  ])('maps %s to %s', (state, column) => {
    expect(EXTERNAL_TASK_COLUMN[state]).toBe(column)
  })
})
