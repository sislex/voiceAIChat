import type { BrowserSelectorResult } from '@voicechat/shared'

import { DOM_HELPERS } from './domHelpers.js'

/** Один проход сохраняет соответствие узлов и селекторов. Function собирается
 * из константы здесь, а Playwright сериализует её и вызывает в странице.
 * Строка со стрелочной функцией в evaluate лишь возвращает функцию, не вызывает. */
export const findElements = new Function('nodes', 'limit', `
  ${DOM_HELPERS}
  return { total: nodes.length, ...(nodes.length > limit ? { truncated: true } : {}), matches: nodes.slice(0, limit).map(node => ({ ...targetOf(node), text: textOf(node).slice(0, 200), visible: visible(node) })) };
`) as (nodes: unknown[], limit: unknown) => ReadContent

export const readPage = new Function('scope', 'options', `
  ${DOM_HELPERS}
  const elements = elementsOf(scope);
  const all = selector => elements.filter(node => node.matches(selector) && visible(node));
  const labelOf = node => node.getAttribute('aria-label') || (node.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => node.getRootNode().getElementById(id)?.textContent || '').join(' ').trim() || [...(node.labels || [])].map(label => label.innerText).join(' ').trim();
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
    ...targetOf(node), type: node.localName === 'input' ? node.type : node.localName,
    name: (node.name || '').slice(0, 200), placeholder: (node.getAttribute('placeholder') || '').slice(0, 200),
    value: node.type === 'password' ? '' : String(node.value || '').slice(0, 200),
    label: labelOf(node).slice(0, 200), disabled: node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true',
    ...(['checkbox', 'radio'].includes(node.type) ? { checked: node.checked } : {})
  })), 50);
  const tables = bounded(all('table').map(table => {
    const rows = [...table.rows], totalColumns = Math.max(0, ...rows.map(row => row.cells.length));
    const result = { ...targetOf(table), caption: (table.caption?.innerText || '').slice(0, 200), rows: rows.slice(0, 20).map(row => [...row.cells].slice(0, 20).map(cell => textOf(cell).slice(0, 200))), totalRows: rows.length, totalColumns };
    if (rows.length > 20 || totalColumns > 20) result.truncated = true;
    while (result.rows.length && JSON.stringify(result).length > budget) { result.rows.pop(); result.truncated = true; }
    return result;
  }), 10);
  const frames = bounded(all('iframe,frame').map(node => ({ ...targetOf(node), src: node.src || '', title: (node.title || '').slice(0, 200), name: (node.name || '').slice(0, 200) })), 20);
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
