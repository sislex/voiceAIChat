// Scroll-derived UI state of the page frame: reading progress, the «to top»
// button and the phone toolbar that hides while reading and returns on the
// way back up — the behaviour of a mobile browser's address bar.

export interface PageScrollState {
  /** 0–100, 100 when the page fits without scrolling. */
  progress: number
  /** Far enough down that a «to top» button saves a long scroll. */
  showTop: boolean
}

export function pageScrollState(scrollTop: number, scrollHeight: number, viewportHeight: number): PageScrollState {
  const max = Math.max(0, scrollHeight - viewportHeight)
  const progress = max > 0 ? Math.min(100, Math.max(0, Math.round(scrollTop / max * 100))) : 100
  return { progress, showTop: viewportHeight > 0 && scrollTop > viewportHeight * 1.5 }
}

/** Threshold that separates a deliberate scroll from a jitter of the finger. */
const SCROLL_STEP = 12
/** Above this the toolbar stays: the page top is where the address is needed most. */
const TOP_ZONE = 96

/**
 * Whether the toolbar should be hidden after a scroll from `previousTop` to `top`.
 * Only phones hide it (`compact`); scrolling down past the top zone hides,
 * any noticeable scroll up or returning to the top shows it again.
 */
export function toolbarHiddenAfterScroll(hidden: boolean, previousTop: number, top: number, compact: boolean): boolean {
  if (!compact) return false
  if (top <= TOP_ZONE) return false
  if (top > previousTop + SCROLL_STEP) return true
  if (top < previousTop - SCROLL_STEP) return false
  return hidden
}
