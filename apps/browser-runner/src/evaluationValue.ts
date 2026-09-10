import { BROWSER_EVALUATE_RESULT_BUDGET } from '@voicechat/shared'
// Чистое тело renderer: tsx не должен внедрить в него Node-helper __name.
export const EVALUATION_SERIALIZER = String.raw`
function serialize(value) {
  const budget = ${BROWSER_EVALUATE_RESULT_BUDGET};
  let truncated = false, preview = false, nodes = 0;
  const seen = new Map();
  const pointer = (path, key) => path + '/' + String(key).replaceAll('~', '~0').replaceAll('/', '~1');
  const clip = (text, limit = 4000) => {
    text = String(text);
    if (text.length <= limit) return text;
    truncated = true;
    let end = limit;
    if (end > 0 && /[\uD800-\uDBFF]/.test(text[end-1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    return text.slice(0, end) + '…';
  };
  const tag = (type, extra = {}) => { preview = true; return { $type: type, ...extra }; };
  const omitted = () => { truncated = true; return tag('omitted'); };
  const walk = (item, path, depth) => {
    if (++nodes > 500 || depth > 8) return omitted();
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'string') return clip(item);
    if (typeof item === 'number') return Number.isFinite(item) && !Object.is(item, -0) ? item : tag('number', { value: String(item), ...(Object.is(item, -0) ? { value: '-0' } : {}) });
    if (typeof item === 'undefined') return tag('undefined');
    if (typeof item === 'bigint') return tag('bigint', { value: clip(item.toString()) });
    if (typeof item === 'symbol') return tag('symbol', { value: clip(String(item), 500) });
    if (typeof item === 'function') return tag('function', { name: clip(item.name, 200) });
    if (seen.has(item)) { preview = true; return { $ref: seen.get(item) }; }
    seen.set(item, path);
    try {
      if (item instanceof Node) {
        if (item.nodeType === 9) return tag('Document', { title: clip(item.title, 500), url: clip(item.URL, 2000) });
        if (item.nodeType === 1) return tag('Element', { tag: item.tagName.toLowerCase(), id: clip(item.id, 200), role: clip(item.getAttribute('role') || '', 100), label: clip(item.getAttribute('aria-label') || '', 500), text: clip(item.textContent || '', 2000), connected: item.isConnected });
        return tag('Node', { name: item.nodeName, text: clip(item.textContent || '', 2000), connected: item.isConnected });
      }
      if (item instanceof Date) return tag('Date', { value: Number.isNaN(item.getTime()) ? 'Invalid Date' : item.toISOString() });
      if (item instanceof RegExp) return tag('RegExp', { source: clip(item.source), flags: item.flags });
      if (item instanceof Error) return tag('Error', { name: clip(item.name, 200), message: clip(item.message), stack: clip(item.stack || '', 4000) });
      if (item instanceof Map) {
        const entries = []; let index = 0;
        for (const [key, entry] of item) { if (index >= 100 || nodes >= 500) { truncated = true; break; } entries.push([walk(key, path + '/entries/' + index + '/0', depth+1), walk(entry, path + '/entries/' + index + '/1', depth+1)]); index++; }
        return tag('Map', { size: item.size, entries });
      }
      if (item instanceof Set) {
        const values = []; let index = 0;
        for (const entry of item) { if (index >= 100 || nodes >= 500) { truncated = true; break; } values.push(walk(entry, path + '/values/' + index, depth+1)); index++; }
        return tag('Set', { size: item.size, values });
      }
      if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
        const raw = item instanceof ArrayBuffer ? new Uint8Array(item) : item instanceof DataView ? new Uint8Array(item.buffer, item.byteOffset, item.byteLength) : item;
        if (raw.length > 100) truncated = true;
        return tag(item instanceof ArrayBuffer ? 'ArrayBuffer' : item.constructor.name, { byteLength: item.byteLength, values: Array.from(raw.slice(0, 100), (value, index) => walk(value, path+'/values/'+index, depth+1)) });
      }
      if (Array.isArray(item)) {
        if (item.length > 100) truncated = true;
        const values = [];
        for (let i=0; i<Math.min(item.length,100); i++) {
          if (nodes >= 500) { truncated = true; break; }
          const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
          values.push(!descriptor ? tag('empty') : 'value' in descriptor ? walk(descriptor.value, pointer(path,i), depth+1) : tag('accessor'));
        }
        return values;
      }
      const keys = Object.keys(item), result = Object.create(null);
      if (keys.length > 100) truncated = true;
      for (const key of keys.slice(0,100)) {
        if (nodes >= 500) { truncated = true; break; }
        const descriptor = Object.getOwnPropertyDescriptor(item, key), name = clip(key, 500);
        result[name] = descriptor && 'value' in descriptor ? walk(descriptor.value, pointer(path,name), depth+1) : tag('accessor');
      }
      return result;
    } catch (error) { return tag('unavailable', { reason: clip(String(error), 300) }); }
  };
  const result = walk(value, '/value', 0);
  const payload = { ok: true, value: result, valueType: value === null ? 'null' : typeof value, valueFormat: preview ? 'preview' : 'json', ...(truncated ? { truncated: true } : {}) };
  if (JSON.stringify(payload).length <= budget) return payload;
  // Префикс явно помечается как неполный JSON, а не выдаётся за исходную строку.
  const json = JSON.stringify(result); let low = 0, high = Math.min(json.length,budget-1000);
  while (low < high) { const mid = Math.ceil((low+high)/2); if (JSON.stringify(json.slice(0,mid)).length <= budget-1000) low=mid; else high=mid-1; }
  let end = low;
  if (end > 0 && /[\uD800-\uDBFF]/.test(json[end-1]) && /[\uDC00-\uDFFF]/.test(json[end])) end--;
  return { ok: true, value: json.slice(0,end), valueType: payload.valueType, valueFormat: 'preview-json', truncated: true };
}
`
