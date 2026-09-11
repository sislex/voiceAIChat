import { expect, it } from 'vitest'
import { emptyScenarioEditor as empty, scenarioEditorReducer as reduce } from './scenarioEditor'
const step = { kind: 'click' as const, selector: '#a', text: '', sensitive: false }
it('undoes and redoes edits and discards redo after a new edit', () => {
  const first = reduce(empty, { kind: 'edit', value: [step] })
  const undo = reduce(first, { kind: 'undo' }); expect(undo.steps).toEqual([])
  expect(reduce(undo, { kind: 'redo' }).steps).toEqual([step])
  expect(reduce(undo, { kind: 'edit', value: [{ ...step, selector: '#b' }] }).future).toEqual([])
})
it('clears history when loading another page or marking a value secret', () => {
  const state = reduce(empty, { kind: 'edit', value: [step] })
  const next = reduce(state, { kind: 'replace', value: [] }); expect(next).toEqual(empty)
})
it('bounds the recoverable history and step count', () => {
  let state = empty
  for (let i = 0; i < 40; i++) state = reduce(state, { kind: 'edit', value: [{ ...step, selector: String(i) }] })
  expect(state.past).toHaveLength(30)
  expect(reduce(state, { kind: 'edit', value: Array(201).fill(step) }).steps).toHaveLength(200)
})
it('does not create history for unchanged steps', () => { expect(reduce(empty, { kind: 'edit', value: [] })).toBe(empty) })
