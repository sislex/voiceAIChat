// Мультивыбор файлов в дереве Make (roadmap-4 п.10): чистая логика без React.
// Обычный клик открывает файл; Ctrl/Cmd-клик переключает файл в наборе; Shift-клик
// добавляет диапазон от «якоря» (последнего переключённого) до текущего в порядке дерева.

export interface MakeSelectionState {
  paths: string[]
  anchor: string | null
}

export const EMPTY_MAKE_SELECTION: MakeSelectionState = { paths: [], anchor: null }

export function toggleMakeSelection(state: MakeSelectionState, path: string, order: string[], mode: 'toggle' | 'range'): MakeSelectionState {
  if (mode === 'range' && state.anchor && order.includes(state.anchor)) {
    const a = order.indexOf(state.anchor), b = order.indexOf(path)
    if (b < 0) return state
    const [from, to] = a <= b ? [a, b] : [b, a]
    const range = order.slice(from, to + 1)
    return { paths: Array.from(new Set([...state.paths, ...range])), anchor: state.anchor }
  }
  const has = state.paths.includes(path)
  return { paths: has ? state.paths.filter((p) => p !== path) : [...state.paths, path], anchor: path }
}

/** После удаления/переименования выбор чистится от пропавших путей. */
export function pruneMakeSelection(state: MakeSelectionState, existing: string[]): MakeSelectionState {
  const set = new Set(existing)
  const paths = state.paths.filter((p) => set.has(p))
  return { paths, anchor: state.anchor && set.has(state.anchor) ? state.anchor : null }
}
