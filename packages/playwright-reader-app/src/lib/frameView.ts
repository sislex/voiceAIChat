/**
 * Viewing the remote frame on whatever screen the person actually has. The pane
 * was built for a wide desktop split: the frame is fitted to the panel width, so
 * on a phone a 1280px viewport arrives at ~0.3 scale and its text is unreadable,
 * and the only way to scroll the page was a mouse wheel, which a phone has not.
 *
 * Pure functions here, DOM in the component: the same arithmetic decides the
 * zoom button state and the coordinates a click is translated into, and it has
 * to be verifiable without a browser.
 */

/** Zoom of the frame image. `fit` keeps the old behaviour: the full viewport width. */
export type FrameZoom = 'fit' | number

/** Steps a person expects from a zoom control; 1 is one CSS pixel per device pixel. */
export const FRAME_ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3] as const

/** Next zoom in the given direction; `fit` enters the ladder at the nearest step. */
export function nextFrameZoom(current: FrameZoom, direction: 'in' | 'out', fitScale: number): FrameZoom {
  const from = current === 'fit' ? fitScale : current
  const steps = FRAME_ZOOM_STEPS
  if (direction === 'in') return steps.find((step) => step > from + 0.001) ?? steps[steps.length - 1]
  return [...steps].reverse().find((step) => step < from - 0.001) ?? steps[0]
}

/** Width in CSS pixels the frame image should occupy; `fit` keeps the CSS rule. */
export function frameWidth(zoom: FrameZoom, viewportWidth: number): number | null {
  if (zoom === 'fit') return null
  return Math.max(1, Math.round(viewportWidth * zoom))
}

/** Scale the `fit` mode currently renders at — the entry point of the zoom ladder. */
export function fitScale(containerWidth: number, viewportWidth: number): number {
  return containerWidth > 0 && viewportWidth > 0 ? containerWidth / viewportWidth : 1
}

export interface TouchPoint {
  clientX: number
  clientY: number
}

/**
 * Finger drag translated into a wheel step. A person drags the page up to read
 * further down, so the sign is inverted against the finger movement — the same
 * convention every mobile browser uses.
 */
export function touchScrollDelta(
  from: TouchPoint,
  to: TouchPoint,
  rendered: { width: number; height: number },
  viewport: { width: number; height: number }
): { deltaX: number; deltaY: number } {
  const scaleX = rendered.width > 0 ? viewport.width / rendered.width : 1
  const scaleY = rendered.height > 0 ? viewport.height / rendered.height : 1
  return {
    deltaX: Math.round((from.clientX - to.clientX) * scaleX),
    deltaY: Math.round((from.clientY - to.clientY) * scaleY)
  }
}

/** Distance between two fingers — the pinch gesture in one number. */
export function pinchDistance(first: TouchPoint, second: TouchPoint): number {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
}

/** A drag under this many CSS pixels is a tap, not a scroll: fingers are never still. */
export const TOUCH_TAP_SLOP = 8

export interface PanelKeyEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** What a panel-level shortcut means. The frame keeps its own keys — these fire
 *  only where the page itself is not listening (toolbar, address bar, chrome). */
export type PanelShortcut = 'back' | 'forward' | 'reload' | 'address' | 'exitFullscreen'

/**
 * Browser shortcuts a person presses without thinking. They cannot be handed to
 * the page: Alt+Left inside the frame is a page shortcut, while here it means
 * "go back", exactly as it does in the surrounding browser.
 */
export function panelShortcut(event: PanelKeyEvent): PanelShortcut | null {
  if (event.key === 'Escape') return 'exitFullscreen'
  const primary = event.ctrlKey || event.metaKey
  if (event.altKey && !primary && event.key === 'ArrowLeft') return 'back'
  if (event.altKey && !primary && event.key === 'ArrowRight') return 'forward'
  if (primary && !event.altKey && event.key.toLowerCase() === 'r') return 'reload'
  if (primary && !event.altKey && event.key.toLowerCase() === 'l') return 'address'
  return null
}
