import { DOM_HELPERS } from './domHelpers.js'

/**
 * Keyboard-side reading of the page: which element the caret sits on, what a
 * person would copy, and whether the focus ring is actually drawn. Kept next to
 * describeElement because both build the same selector — a focused element the
 * model cannot address again is of no use to it.
 */
export function focusStateScript(): string {
  return `(() => {
    ${DOM_HELPERS}
    let node = document.activeElement;
    // An open shadow root reports its host as activeElement; follow it down to
    // the real field, otherwise every web component looks the same to us.
    while (node && node.shadowRoot && node.shadowRoot.activeElement) node = node.shadowRoot.activeElement;
    if (!node || node === document.body || node === document.documentElement) return { none: true };
    const target = targetOf(node), box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const ring = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || (style.boxShadow !== 'none' && style.boxShadow !== '');
    const value = typeof node.value === 'string' ? node.value : undefined;
    return {
      ...target,
      tag: node.localName,
      role: node.getAttribute('role') || undefined,
      name: node.getAttribute('aria-label') || node.getAttribute('name') || undefined,
      text: textOf(node).slice(0, 120),
      ...(value !== undefined ? { value: value.slice(0, 200) } : {}),
      disabled: node.disabled === true || node.getAttribute('aria-disabled') === 'true',
      readOnly: node.readOnly === true,
      visibleRing: ring,
      withinDialog: Boolean(node.closest('[role="dialog"],[role="alertdialog"],dialog')),
      rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
    };
  })()`
}

/** Text the person would copy: selection of the page or of the focused field. */
export function selectionScript(limit: number): string {
  return `(() => {
    const active = document.activeElement;
    // A selection inside input/textarea never shows up in window.getSelection().
    if (active && typeof active.selectionStart === 'number' && active.selectionStart !== active.selectionEnd)
      return String(active.value).slice(active.selectionStart, active.selectionEnd).slice(0, ${limit} + 1);
    return String(window.getSelection() || '').slice(0, ${limit} + 1);
  })()`
}

/** Select the text of one element, the way dragging across it would. */
export function selectElementScript(): (node: unknown) => unknown {
  return (node: unknown) => {
    const element = node as { select?: () => void; setSelectionRange?: (a: number, b: number) => void; value?: string }
    if (typeof element.select === 'function') { element.select(); return true }
    const scope = globalThis as unknown as { document: { createRange(): { selectNodeContents(node: unknown): void } }; getSelection(): { removeAllRanges(): void; addRange(range: unknown): void } | null }
    const range = scope.document.createRange()
    range.selectNodeContents(node)
    const selection = scope.getSelection()
    if (!selection) return false
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }
}

/**
 * Paste as the browser delivers it: a real paste event with clipboardData, so
 * editors that read the event (and ignore plain input) behave as they do for a
 * person. Falls back to a value write when the page does not handle the event.
 */
export function pasteScript(): (node: unknown, text: unknown) => unknown {
  return (node: unknown, text: unknown) => {
    const element = node as {
      focus(): void
      dispatchEvent(event: unknown): boolean
      value?: string
      selectionStart?: number | null
      selectionEnd?: number | null
      isContentEditable?: boolean
    }
    const value = String(text)
    element.focus()
    const scope = globalThis as unknown as {
      DataTransfer: new () => { setData(type: string, value: string): void }
      ClipboardEvent: new (type: string, init: unknown) => unknown
      InputEvent: new (type: string, init: unknown) => unknown
      Event: new (type: string, init: unknown) => unknown
    }
    let handled = false
    try {
      const data = new scope.DataTransfer()
      data.setData('text/plain', value)
      handled = element.dispatchEvent(new scope.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })) === false
    } catch { handled = false }
    if (!handled) {
      if (typeof element.value === 'string') {
        const start = element.selectionStart ?? element.value.length
        const end = element.selectionEnd ?? element.value.length
        element.value = element.value.slice(0, start) + value + element.value.slice(end)
      } else if (element.isContentEditable) {
        const document = (globalThis as unknown as { document: { execCommand(name: string, ui: boolean, value: string): boolean } }).document
        document.execCommand('insertText', false, value)
      } else return false
      element.dispatchEvent(new scope.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: value }))
      element.dispatchEvent(new scope.Event('change', { bubbles: true }))
    }
    return true
  }
}

/**
 * Tab order as the browser builds it: positive tabindex first (in value order),
 * then everything reachable in DOM order. Reading it is how a keyboard-only
 * person is modelled without pressing Tab a hundred times — and pressing Tab
 * blind is exactly how the model used to get lost in a trapped modal.
 */
export function focusOrderScript(root: string | null, limit: number): string {
  return `(() => {
    ${DOM_HELPERS}
    const scope = ${root ? `document.querySelector(${JSON.stringify(root)})` : 'document.body'};
    if (!scope) return null;
    const selector = 'a[href],area[href],button,input,select,textarea,iframe,summary,[tabindex],[contenteditable="true"]';
    const seen = [];
    for (const node of scope.querySelectorAll(selector)) {
      const tabIndex = node.tabIndex;
      if (tabIndex < 0) continue;
      if (node.disabled === true) continue;
      if (node.type === 'hidden') continue;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const visible = box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      seen.push({
        ...targetOf(node),
        tag: node.localName,
        name: (node.getAttribute('aria-label') || node.getAttribute('title') || textOf(node) || node.getAttribute('placeholder') || node.getAttribute('name') || '').slice(0, 80),
        role: node.getAttribute('role') || undefined,
        tabIndex,
        visible,
        ...(node.disabled === true || node.getAttribute('aria-disabled') === 'true' ? { disabled: true } : {})
      });
    }
    // Positive tabindex jumps the queue; keeping DOM order for the rest matches
    // what the browser does, so the list reads like the walk itself.
    const positive = seen.filter(item => item.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
    const natural = seen.filter(item => item.tabIndex === 0);
    return { total: seen.length, items: positive.concat(natural).slice(0, ${limit}) };
  })()`
}
