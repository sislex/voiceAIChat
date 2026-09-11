import { useCallback, useReducer, type SetStateAction } from 'react'
import type { WebRecorderScenarioStep as Step } from '@shared/webRecorder'
import { WEB_RECORDER_SCENARIO_LIMITS } from '@shared/webRecorderScenario'

export interface ScenarioEditorState { steps: Step[]; past: Step[][]; future: Step[][] }
type Action = { kind: 'replace' | 'edit'; value: SetStateAction<Step[]> } | { kind: 'undo' } | { kind: 'redo' }
export const emptyScenarioEditor: ScenarioEditorState = { steps: [], past: [], future: [] }
export function scenarioEditorReducer(state: ScenarioEditorState, action: Action): ScenarioEditorState {
  if (action.kind === 'undo') {
    if (!state.past.length) return state
    return { steps: state.past[state.past.length - 1], past: state.past.slice(0, -1), future: [state.steps, ...state.future] }
  }
  if (action.kind === 'redo') {
    if (!state.future.length) return state
    return { steps: state.future[0], past: [...state.past, state.steps], future: state.future.slice(1) }
  }
  const steps = (typeof action.value === 'function' ? action.value(state.steps) : action.value).slice(0, WEB_RECORDER_SCENARIO_LIMITS.steps)
  // Loading another page and marking text secret must discard recoverable history.
  if (action.kind === 'replace') return { steps, past: [], future: [] }
  if (JSON.stringify(steps) === JSON.stringify(state.steps)) return state
  return { steps, past: [...state.past.slice(-29), state.steps], future: [] }
}
export function useScenarioEditor() {
  const [state, dispatch] = useReducer(scenarioEditorReducer, emptyScenarioEditor)
  const setSteps = useCallback((value: SetStateAction<Step[]>) => dispatch({ kind: 'replace', value }), [])
  const editSteps = useCallback((value: SetStateAction<Step[]>) => dispatch({ kind: 'edit', value }), [])
  return { ...state, setSteps, editSteps, undo: () => dispatch({ kind: 'undo' }), redo: () => dispatch({ kind: 'redo' }) }
}
