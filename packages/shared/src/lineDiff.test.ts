import { describe, expect, it } from 'vitest'
import { changedLines } from './lineDiff'

describe('changedLines', () => {
  it('находит добавленные и изменённые строки, не трогая совпавшие', () => {
    expect(changedLines('a\nb\nc', 'a\nB\nc\nd')).toEqual([2, 4])
    expect(changedLines('a\nb', 'a\nb')).toEqual([])
    expect(changedLines('', 'x\ny')).toEqual([1, 2])
    expect(changedLines('x\ny\nz', 'y')).toEqual([])
  })
})
