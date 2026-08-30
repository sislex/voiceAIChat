import '@testing-library/jest-dom/vitest'
if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent
if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    dispatchEvent: () => false
  })) as typeof matchMedia
}
