import { DOM_HELPERS } from './domHelpers.js'

/** Координата приходит с кадра. Shadow host скрывает настоящий hit от document;
 * раскрываем открытые roots и ищем интерактивного предка без лимита глубины. */
export function describeElementScript(x: number, y: number): string {
  return `(() => {
    ${DOM_HELPERS}
    let hit = document.elementFromPoint(${x}, ${y});
    if (!hit) return null;
    for (;;) {
      const inner = hit.shadowRoot?.elementFromPoint(${x}, ${y});
      if (!inner || inner === hit) break;
      hit = inner;
    }
    const parentOf = node => node.parentElement || node.getRootNode().host;
    const interactive = 'button,a[href],input,select,textarea,label,[role="button"],[role="link"],[role="checkbox"],[contenteditable="true"]';
    let node = hit, known = null;
    for (let current = hit; current && current.localName !== 'body'; current = parentOf(current)) {
      if (current.matches(interactive)) { node = current; break; }
      if (!known && (current.id || current.hasAttribute('data-testid'))) known = current;
      if (!parentOf(current) || parentOf(current).localName === 'body') node = known || hit;
    }
    const target = targetOf(node), selector = target.selector;
    let stability = 'path';
    if (node.getAttribute('data-testid') && selector.endsWith('[data-testid="' + CSS.escape(node.getAttribute('data-testid')) + '"]')) stability = 'testid';
    else if (node.id && selector.endsWith('#' + CSS.escape(node.id))) stability = 'id';
    else if (node.getAttribute('aria-label') && selector.endsWith('[aria-label="' + CSS.escape(node.getAttribute('aria-label')) + '"]')) stability = 'label';
    else if (node.getAttribute('role') && selector.endsWith('[role="' + CSS.escape(node.getAttribute('role')) + '"]')) stability = 'role';
    const box = node.getBoundingClientRect();
    return { ...target, stability, matches: 1, tag: node.localName, text: textOf(node).slice(0, 120), rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } };
  })()`
}
