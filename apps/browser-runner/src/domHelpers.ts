// Эти функции сериализуются в Chromium. Обход composed tree нужен компонентам
// с открытым Shadow DOM: обычные querySelectorAll/innerText теряют их содержимое.
export const DOM_HELPERS = String.raw`
  const identityOf = node => {
    const parts = [];
    for (let current = node; current && current.nodeType === 1;) {
      const parent = current.parentNode;
      parts.unshift([...parent.children].indexOf(current));
      if (parent.host) { parts.unshift('shadow'); current = parent.host; }
      else current = current.parentElement;
    }
    return JSON.stringify(parts);
  };
  const selectorOf = node => {
    const root = node.getRootNode();
    const unique = selector => { const matches = root.querySelectorAll(selector); return matches.length === 1 && matches[0] === node; };
    const prefix = selector => root.host ? selectorOf(root.host) + ' >> ' + selector : selector;
    const candidates = [];
    for (const attribute of ['data-testid', 'id', 'aria-label', 'name', 'role']) {
      const value = node.getAttribute(attribute);
      if (value) candidates.push(attribute === 'id' ? '#' + CSS.escape(value) : (attribute === 'data-testid' ? '' : node.localName) + '[' + attribute + '="' + CSS.escape(value) + '"]');
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
  const targetOf = node => ({ selector: selectorOf(node), __targetPath: identityOf(node) });
  const visible = node => {
    const style = getComputedStyle(node), box = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.visibility !== 'collapse' && box.width > 0 && box.height > 0;
  };
  const childrenOf = node => node.shadowRoot ? [...node.shadowRoot.childNodes] : node.localName === 'slot' ? (node.assignedNodes({ flatten: true }).length ? node.assignedNodes({ flatten: true }) : [...node.childNodes]) : [...node.childNodes];
  const elementsOf = scope => {
    const result = [], visited = new Set();
    const visit = node => {
      if (visited.has(node)) return;
      visited.add(node);
      if (node.nodeType === 1) result.push(node);
      for (const child of childrenOf(node)) visit(child);
    };
    visit(scope); return result;
  };
  const textOf = node => {
    if (node.localName === 'input') return node.type === 'password' ? '' : String(node.value || '');
    if (node.localName === 'textarea') return String(node.value || '');
    if (node.localName === 'select') return [...node.selectedOptions].map(option => option.textContent || '').join(', ');
    if (!elementsOf(node).some(element => element.shadowRoot)) return String(typeof node.innerText === 'string' ? node.innerText : node.textContent || '').trim();
    const parts = [], visited = new Set();
    const visit = current => {
      if (visited.has(current)) return;
      visited.add(current);
      if (current.nodeType === 3) {
        const parent = current.parentElement || current.parentNode.host;
        if (!parent || getComputedStyle(parent).visibility !== 'visible') return;
        const range = document.createRange(); range.selectNodeContents(current);
        if ([...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) parts.push(current.nodeValue);
        return;
      }
      if (current.nodeType !== 1 || ['script', 'style', 'noscript', 'template'].includes(current.localName)) return;
      const style = getComputedStyle(current);
      if (style.display === 'none') return;
      if (current.localName === 'br') { parts.push('\n'); return; }
      const block = ['block', 'flex', 'grid', 'table', 'table-row', 'list-item'].includes(style.display);
      if (block) parts.push('\n');
      for (const child of childrenOf(current)) visit(child);
      if (block) parts.push('\n');
    };
    visit(node);
    return parts.join('').replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
`
