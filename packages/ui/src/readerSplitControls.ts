// Pure helpers for the Reader split screen: keyboard resizing of the divider and
// the "something changed on the hidden pane" marker for the phone tabs. Kept
// out of App.tsx so both behaviours are testable without mounting the shell.

export const PREVIEW_WIDTH_MIN = 25
export const PREVIEW_WIDTH_MAX = 75
export const PREVIEW_WIDTH_DEFAULT = 45
const PREVIEW_WIDTH_STEP = 2

export function clampPreviewWidth(value: number): number {
  if (!Number.isFinite(value)) return PREVIEW_WIDTH_DEFAULT
  return Math.min(PREVIEW_WIDTH_MAX, Math.max(PREVIEW_WIDTH_MIN, value))
}

/**
 * Keyboard on the vertical separator. The preview sits on the right, so moving the
 * divider left (ArrowLeft) gives the site more room. Home/End jump to the limits,
 * Enter restores the default split. Returns null for keys the separator ignores.
 */
export function previewWidthAfterKey(current: number, key: string, shift = false): number | null {
  const step = shift ? PREVIEW_WIDTH_STEP * 5 : PREVIEW_WIDTH_STEP
  switch (key) {
    case 'ArrowLeft': return clampPreviewWidth(current + step)
    case 'ArrowRight': return clampPreviewWidth(current - step)
    case 'Home': return PREVIEW_WIDTH_MIN
    case 'End': return PREVIEW_WIDTH_MAX
    case 'Enter': return PREVIEW_WIDTH_DEFAULT
    default: return null
  }
}

export type SplitView = 'chat' | 'preview'
export type SplitAttentionEvent =
  | { type: 'reader-changed'; view: SplitView }
  | { type: 'assistant-reply'; view: SplitView }
  | { type: 'switch'; view: SplitView }
  | { type: 'conversation' }

/** Which hidden tab deserves a marker: the model acted on the site while the chat was shown, or replied while the site was shown. */
export function splitAttentionReducer(state: SplitView | null, event: SplitAttentionEvent): SplitView | null {
  switch (event.type) {
    case 'reader-changed': return event.view === 'chat' ? 'preview' : state
    case 'assistant-reply': return event.view === 'preview' ? 'chat' : state
    case 'switch': return state === event.view ? null : state
    case 'conversation': return null
  }
}

/** Compact present-tense label for the phone tab bar; the panel itself is hidden behind the chat tab. */
export function pendingActionLabel(action: { kind: string; text?: string; selector?: string; field?: string; url?: string; key?: string; role?: string }): string {
  const target = action.text ?? action.field ?? action.role ?? action.selector
  switch (action.kind) {
    case 'open': return 'открывает страницу'
    case 'click': return target ? `нажимает «${target}»` : 'нажимает элемент'
    case 'type': return target ? `вводит текст в «${target}»` : 'вводит текст'
    case 'read': return 'читает страницу'
    case 'find': return target ? `ищет «${target}»` : 'ищет элементы'
    case 'screenshot': return 'делает снимок'
    case 'scroll': return 'прокручивает страницу'
    case 'press': return action.key ? `нажимает ${action.key}` : 'нажимает клавишу'
    case 'wait': return 'ждёт страницу'
    case 'back': return 'переходит назад'
    case 'forward': return 'переходит вперёд'
    default: return 'работает со страницей'
  }
}

/** Phone tab label: the page title tells where the site pane is, truncated by CSS. */
export function siteTabLabel(base: string, title: string | null): string {
  const clean = (title ?? '').replace(/\s+/g, ' ').trim()
  return clean ? `${base} · ${clean}` : base
}
