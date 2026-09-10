import type { BrowserSelectorResult } from '@voicechat/shared'

// Код выполняется в документе Chromium; Node-пакету не нужна библиотека DOM.
// Селектор строится по найденному узлу, поэтому текст с >> не становится кодом
// движка селекторов, а повторяющиеся метки не отправляют действие к первому узлу.
const helpers = String.raw`
  const textOf = node => {
    if (node.localName === 'input') return node.type === 'password' ? '' : String(node.value || '');
    if (node.localName === 'textarea') return String(node.value || '');
    if (node.localName === 'select') return [...node.selectedOptions].map(option => option.textContent || '').join(', ');
    return String(typeof node.innerText === 'string' ? node.innerText : node.textContent || '').trim();
  };
  const visible = node => {
    const style = getComputedStyle(node), box = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.visibility !== 'collapse' && box.width > 0 && box.height > 0;
  };
  const selectorOf = node => {
    const root = node.getRootNode();
    const unique = selector => { const matches = root.querySelectorAll(selector); return matches.length === 1 && matches[0] === node; };
    const prefix = selector => root.host ? selectorOf(root.host) + ' >> ' + selector : selector;
    const candidates = [];
    for (const attribute of ['data-testid', 'id', 'aria-label', 'name']) {
      const value = node.getAttribute(attribute);
      if (value) candidates.push(attribute === 'id' ? '#' + CSS.escape(value) : node.localName + '[' + attribute + '="' + CSS.escape(value) + '"]');
    }
    for (const candidate of candidates) if (unique(candidate)) return prefix(candidate);
    const parts = [];
    for (let current = node; current; current = current.parentElement) {
      const siblings = current.parentElement ? [...current.parentElement.children].filter(sibling => sibling.localName === current.localName) : [];
      parts.unshift(CSS.escape(current.localName) + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' : ''));
      const candidate = parts.join(' > ');
      if (unique(candidate)) return prefix(candidate);
    }
    return prefix(parts.join(' > '));
  };
`

/** Один проход сохраняет соответствие узлов и селекторов. Function собирается
 * из константы здесь, а Playwright сериализует её и вызывает в странице.
 * Строка со стрелочной функцией в evaluate лишь возвращает функцию, не вызывает. */
export const findElements = new Function('nodes', 'limit', `
  ${helpers}
  return { total: nodes.length, ...(nodes.length > limit ? { truncated: true } : {}), matches: nodes.slice(0, limit).map(node => ({ selector: selectorOf(node), text: textOf(node).slice(0, 200), visible: visible(node) })) };
`) as (nodes: unknown[], limit: unknown) => ReadContent

export const readPage = new Function('scope', 'options', `
  ${helpers}
  const all = selector => [...(scope.matches(selector) ? [scope] : []), ...scope.querySelectorAll(selector)].filter(visible);
  const labelOf = node => node.getAttribute('aria-label') || (node.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => node.ownerDocument.getElementById(id)?.textContent || '').join(' ').trim() || [...(node.labels || [])].map(label => label.innerText).join(' ').trim();
  let budget = 8000, structureTruncated = false;
  const bounded = (items, limit) => {
    const result = [];
    for (const item of items) {
      const size = JSON.stringify(item).length;
      if (result.length >= limit || size > budget) { structureTruncated = true; continue; }
      result.push(item); budget -= size;
    }
    return result;
  };
  const headings = bounded(all('h1,h2,h3,h4,h5,h6').map(node => ({ level: Number(node.localName[1]), text: textOf(node).slice(0, 200) })), 64);
  const links = bounded(all('a[href]').map(node => ({ text: (node.getAttribute('aria-label') || textOf(node)).slice(0, 200), href: node.href })), 100);
  const buttons = bounded(all('button,[role="button"],input[type="submit"],input[type="button"]').map(node => (labelOf(node) || textOf(node)).slice(0, 200)), 50);
  const inputs = bounded(all('input,textarea,select').map(node => ({
    selector: selectorOf(node), type: node.localName === 'input' ? node.type : node.localName,
    name: (node.name || '').slice(0, 200), placeholder: (node.getAttribute('placeholder') || '').slice(0, 200),
    value: node.type === 'password' ? '' : String(node.value || '').slice(0, 200),
    label: labelOf(node).slice(0, 200), disabled: Boolean(node.disabled),
    ...(['checkbox', 'radio'].includes(node.type) ? { checked: node.checked } : {})
  })), 50);
  const tables = bounded(all('table').map(table => {
    const rows = [...table.rows], totalColumns = Math.max(0, ...rows.map(row => row.cells.length));
    const result = { selector: selectorOf(table), caption: (table.caption?.innerText || '').slice(0, 200), rows: rows.slice(0, 20).map(row => [...row.cells].slice(0, 20).map(cell => textOf(cell).slice(0, 200))), totalRows: rows.length, totalColumns };
    if (rows.length > 20 || totalColumns > 20) result.truncated = true;
    while (result.rows.length && JSON.stringify(result).length > budget) { result.rows.pop(); result.truncated = true; }
    return result;
  }), 10);
  const frames = bounded(all('iframe,frame').map(node => ({ selector: selectorOf(node), src: node.src || '', title: (node.title || '').slice(0, 200), name: (node.name || '').slice(0, 200) })), 20);
  const text = textOf(scope), end = Math.min(text.length, options.offset + options.limit);
  return { headings, links, buttons, inputs, tables, frames, text: text.slice(options.offset, end) + (end < text.length ? '…' : ''), total: text.length, offset: options.offset, ...(end < text.length ? { truncated: true, nextOffset: end } : {}), ...(structureTruncated ? { structureTruncated: true } : {}) };
`) as (node: unknown, options: unknown) => ReadContent

/** Невалидные числа не должны превращаться в пустой успешный ответ. */
export function readBounds(limit = 4000, offset = 0): { limit: number; offset: number } {
  if (!Number.isInteger(limit) || limit < 100 || limit > 20_000) throw new Error('limit должен быть целым числом от 100 до 20000')
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset должен быть неотрицательным целым числом')
  return { limit, offset }
}

export type ReadContent = Omit<BrowserSelectorResult, 'ok' | 'page'>
