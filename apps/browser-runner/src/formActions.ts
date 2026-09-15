import { DOM_HELPERS } from './domHelpers.js'

/**
 * Forms as a person deals with them. Filling a form field by field costs the
 * model one round trip per field, and a React form that re-renders between calls
 * can drop everything typed before — so the fill, the read-back and the browser's
 * own validation belong in the page, in one evaluate each.
 *
 * Scripts, not typed helpers: these run inside the page, where our types do not
 * exist, and building them as strings keeps the narrow SelectorPage contract
 * testable without Chromium.
 */

/** Fields of a form (or of the whole page) with their current values. */
export function formStateScript(root: string | null, limit: number): string {
  return `(() => {
    ${DOM_HELPERS}
    const form = ${root ? `document.querySelector(${JSON.stringify(root)})` : 'document.querySelector("form") || document.body'};
    if (!form) return null;
    const controls = form.querySelectorAll('input,select,textarea,[contenteditable="true"]');
    const fields = [];
    for (const node of controls) {
      if (node.type === 'hidden') continue;
      const labelNode = node.labels && node.labels[0];
      const value = node.isContentEditable ? node.textContent : node.value;
      fields.push({
        ...targetOf(node),
        tag: node.localName,
        ...(node.type ? { type: node.type } : {}),
        ...(node.name ? { name: node.name } : {}),
        ...(labelNode || node.getAttribute('aria-label') ? { label: (labelNode ? labelNode.textContent : node.getAttribute('aria-label')).trim().slice(0, 80) } : {}),
        // A password value never leaves the page: it would land in the turn log.
        ...(node.type === 'password' ? {} : { value: String(value == null ? '' : value).slice(0, 200) }),
        ...(node.type === 'checkbox' || node.type === 'radio' ? { checked: node.checked === true } : {}),
        ...(node.required ? { required: true } : {}),
        ...(node.disabled ? { disabled: true } : {}),
        ...(node.readOnly ? { readOnly: true } : {}),
        ...(typeof node.checkValidity === 'function' && !node.checkValidity() ? { invalid: node.validationMessage || 'Поле не прошло проверку' } : {})
      });
    }
    return {
      ...targetOf(form),
      ...(form.action ? { action: form.action } : {}),
      ...(form.method ? { method: form.method } : {}),
      total: fields.length,
      fields: fields.slice(0, ${limit}),
      ...(fields.length > ${limit} ? { truncated: true } : {})
    };
  })()`
}

/**
 * Why the page will not submit. The model used to learn this only by pressing
 * submit and reading whatever the page chose to render — but the browser already
 * knows, field by field, and says so in the user's language.
 */
export function validityScript(root: string | null): string {
  return `(() => {
    ${DOM_HELPERS}
    const scope = ${root ? `document.querySelector(${JSON.stringify(root)})` : 'document.querySelector("form") || document.body'};
    if (!scope) return null;
    const controls = scope.matches('input,select,textarea') ? [scope] : [...scope.querySelectorAll('input,select,textarea')];
    const blocking = [];
    let checked = 0;
    for (const node of controls) {
      if (typeof node.checkValidity !== 'function' || node.disabled || node.type === 'hidden') continue;
      checked++;
      if (node.checkValidity()) continue;
      const state = node.validity, reasons = [];
      for (const key of ['valueMissing', 'typeMismatch', 'patternMismatch', 'tooLong', 'tooShort', 'rangeUnderflow', 'rangeOverflow', 'stepMismatch', 'badInput', 'customError'])
        if (state && state[key]) reasons.push(key);
      blocking.push({ ...targetOf(node), message: node.validationMessage || '', reasons });
    }
    return { valid: blocking.length === 0, blocking, checked };
  })()`
}

/** Options a control offers: select, its datalist, or a radio group by name. */
export function optionsScript(selector: string, limit: number): string {
  return `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const cut = list => ({ total: list.length, items: list.slice(0, ${limit}) });
    if (node.localName === 'select') {
      const list = [...node.options].map(option => ({
        value: option.value,
        label: (option.label || option.textContent || '').trim().slice(0, 120),
        ...(option.selected ? { selected: true } : {}),
        ...(option.disabled ? { disabled: true } : {})
      }));
      return { selector: ${JSON.stringify(selector)}, kind: 'select', ...(node.multiple ? { multiple: true } : {}), ...cut(list) };
    }
    // A text input with list= offers its datalist; that is an autocomplete a
    // person sees as a dropdown, and nothing in the DOM text reveals it.
    const listId = node.getAttribute('list');
    const datalist = listId ? document.getElementById(listId) : null;
    if (datalist) {
      const list = [...datalist.options].map(option => ({ value: option.value, label: (option.label || option.textContent || '').trim().slice(0, 120) }));
      return { selector: ${JSON.stringify(selector)}, kind: 'datalist', ...cut(list) };
    }
    if (node.type === 'radio' && node.name) {
      const list = [...document.querySelectorAll('input[type="radio"][name="' + CSS.escape(node.name) + '"]')].map(radio => ({
        value: radio.value,
        label: (radio.labels && radio.labels[0] ? radio.labels[0].textContent : radio.getAttribute('aria-label') || '').trim().slice(0, 120),
        ...(radio.checked ? { selected: true } : {}),
        ...(radio.disabled ? { disabled: true } : {})
      }));
      return { selector: ${JSON.stringify(selector)}, kind: 'radio', ...cut(list) };
    }
    return null;
  })()`
}

/** Submit the way Enter does: validation first, then the page's own handler. */
export function submitScript(): (node: unknown) => unknown {
  return (node: unknown) => {
    const element = node as { localName?: string; form?: unknown; requestSubmit?: (submitter?: unknown) => void; reportValidity?: () => boolean; closest(selector: string): unknown }
    const form = (element.localName === 'form' ? element : element.form ?? element.closest('form')) as
      | { requestSubmit?: (submitter?: unknown) => void; reportValidity?: () => boolean; submit?: () => void }
      | null
    if (!form) return { ok: false, error: 'Элемент не принадлежит форме' }
    // reportValidity is what the browser does on submit: it both checks and
    // shows the message, so the person and the model see the same reason.
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) return { ok: false, error: 'Форма не прошла проверку браузера' }
    if (typeof form.requestSubmit === 'function') form.requestSubmit()
    else if (typeof form.submit === 'function') form.submit()
    else return { ok: false, error: 'Форма не поддерживает отправку' }
    return { ok: true }
  }
}

/**
 * Files dropped onto a zone. Half the upload widgets on the web have no
 * input[type=file] at all — they listen for a drop, and setInputFiles cannot
 * reach them, so the model simply could not upload anything there.
 */
export function dropFilesScript(): (node: unknown, files: unknown) => unknown {
  return (node: unknown, files: unknown) => {
    const element = node as { dispatchEvent(event: unknown): boolean; getBoundingClientRect(): { left: number; top: number; width: number; height: number } }
    const scope = globalThis as unknown as {
      DataTransfer: new () => { items: { add(file: unknown): void }; files: unknown }
      File: new (parts: unknown[], name: string, options: { type: string }) => unknown
      DragEvent: new (type: string, init: unknown) => unknown
      atob(value: string): string
      Uint8Array: typeof Uint8Array
    }
    const data = new scope.DataTransfer()
    for (const entry of files as Array<{ name: string; mimeType?: string; base64: string }>) {
      const binary = scope.atob(entry.base64)
      const bytes = new scope.Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
      data.items.add(new scope.File([bytes], entry.name, { type: entry.mimeType || 'application/octet-stream' }))
    }
    const box = element.getBoundingClientRect()
    const point = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }
    for (const type of ['dragenter', 'dragover', 'drop'])
      element.dispatchEvent(new scope.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, ...point }))
    return { ok: true, files: (files as unknown[]).length }
  }
}
