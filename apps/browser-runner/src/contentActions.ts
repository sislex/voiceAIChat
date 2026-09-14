import { DOM_HELPERS } from './domHelpers.js'

/**
 * Getting to the content, not just to the element. A person scrolls a feed until
 * the row appears, glances at a table as rows-with-headings, and sees at once how
 * much page is left below. The model had `read` (a flat text slice) and `scroll`
 * (a blind wheel step) — so on a lazy list it either stopped at the first screen
 * or scrolled forever without knowing whether anything was still loading.
 */

/** Geometry of the page: how far it is scrolled and how much remains below. */
export function pageMetricsScript(): string {
  return `(() => {
    const doc = document.scrollingElement || document.documentElement;
    const view = { width: innerWidth, height: innerHeight };
    return {
      scroll: { top: Math.round(doc.scrollTop), left: Math.round(doc.scrollLeft) },
      page: { width: Math.round(doc.scrollWidth), height: Math.round(doc.scrollHeight) },
      viewport: view,
      // Экраны, а не пиксели: «осталось 12 экранов» человек и модель понимают
      // одинаково, а 9000 px не говорят ничего.
      screensBelow: view.height > 0 ? Math.round(((doc.scrollHeight - doc.scrollTop - view.height) / view.height) * 10) / 10 : 0,
      atBottom: doc.scrollHeight - doc.scrollTop - view.height <= 2
    };
  })()`
}

/** Where an element sits relative to the viewport, and whether it is reachable. */
export function measureScript(selector: string): string {
  return `(() => {
    ${DOM_HELPERS}
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const doc = document.scrollingElement || document.documentElement;
    const hidden = style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || box.width === 0 || box.height === 0;
    // Перекрытие липкой шапкой — обычная причина «клик не сработал»: элемент
    // виден в дереве, но в точке клика лежит другой узел.
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const top = document.elementFromPoint(center.x, center.y);
    const covered = Boolean(top) && top !== node && !node.contains(top);
    return {
      ...targetOf(node),
      rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
      inViewport: box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth,
      hidden,
      covered,
      ...(covered && top ? { coveredBy: top.localName + (top.className && typeof top.className === 'string' ? '.' + top.className.trim().split(/\\s+/)[0] : '') } : {}),
      scrollToTop: Math.round(doc.scrollTop + box.top - innerHeight / 2)
    };
  })()`
}

/** A table read the way a person reads it: headings plus rows under them. */
export function tableScript(selector: string, offset: number, limit: number, columns: string[] | null): string {
  return `(() => {
    const table = document.querySelector(${JSON.stringify(selector)});
    if (!table) return null;
    const cell = node => (node.innerText || node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200);
    const rows = [...table.querySelectorAll('tr')];
    if (!rows.length) return null;
    // Заголовок — первая строка с th, иначе первая строка вообще: так таблицу
    // размечает большинство страниц, и угадывание здесь честнее пустого ответа.
    const headRow = rows.find(row => row.querySelector('th')) || rows[0];
    const headings = [...headRow.children].map(cell);
    const wanted = ${columns ? JSON.stringify(columns) : 'null'};
    const keep = wanted ? headings.map((name, index) => (wanted.includes(name) ? index : -1)).filter(index => index >= 0) : null;
    const body = rows.filter(row => row !== headRow);
    const slice = body.slice(${offset}, ${offset} + ${limit}).map(row => {
      const cells = [...row.children].map(cell);
      const record = {};
      (keep || cells.map((_, index) => index)).forEach(index => {
        record[headings[index] || ('колонка ' + (index + 1))] = cells[index] ?? '';
      });
      return record;
    });
    return {
      selector: ${JSON.stringify(selector)},
      headings: keep ? keep.map(index => headings[index]) : headings,
      total: body.length,
      offset: ${offset},
      rows: slice,
      ...(${offset} + slice.length < body.length ? { nextOffset: ${offset} + slice.length } : {})
    };
  })()`
}

/**
 * Repeating blocks — a card list, a feed, search results. Reading such a page as
 * plain text loses which text belongs to which card; the model then clicked the
 * heading of one row and the button of another.
 */
export function listScript(selector: string, offset: number, limit: number): string {
  return `(() => {
    ${DOM_HELPERS}
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    if (!nodes.length) return null;
    const clean = value => (value || '').trim().replace(/\\s+/g, ' ').slice(0, 200);
    const items = nodes.slice(${offset}, ${offset} + ${limit}).map(node => {
      const heading = node.querySelector('h1,h2,h3,h4,[role="heading"]');
      const link = node.querySelector('a[href]');
      const buttons = [...node.querySelectorAll('button,[role="button"],a[href]')].slice(0, 8).map(item => ({
        ...targetOf(item),
        text: clean(item.innerText || item.getAttribute('aria-label'))
      }));
      return {
        ...targetOf(node),
        ...(heading ? { title: clean(heading.innerText) } : {}),
        text: clean(node.innerText),
        ...(link ? { href: link.href } : {}),
        ...(buttons.length ? { actions: buttons } : {})
      };
    });
    return { selector: ${JSON.stringify(selector)}, total: nodes.length, offset: ${offset}, items, ...(${offset} + items.length < nodes.length ? { nextOffset: ${offset} + items.length } : {}) };
  })()`
}

/**
 * Show the person what the model is talking about. A selector in a turn log is
 * unreadable; a box drawn on the frame for a moment is not.
 */
export function highlightScript(selector: string, ms: number): string {
  return `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const box = node.getBoundingClientRect();
    const mark = document.createElement('div');
    mark.setAttribute('data-voicechat-highlight', '1');
    mark.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #e2725b;border-radius:4px;box-shadow:0 0 0 3px rgba(226,114,91,.25);transition:opacity .2s';
    mark.style.left = (box.left - 3) + 'px';
    mark.style.top = (box.top - 3) + 'px';
    mark.style.width = box.width + 'px';
    mark.style.height = box.height + 'px';
    for (const old of document.querySelectorAll('[data-voicechat-highlight]')) old.remove();
    document.body.appendChild(mark);
    setTimeout(() => { mark.style.opacity = '0'; setTimeout(() => mark.remove(), 300); }, ${ms});
    return { rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } };
  })()`
}

/** One scroll step of a lazy feed, with the numbers that say whether to go on. */
export function scrollStepScript(container: string | null, step: number): string {
  return `(() => {
    const node = ${container ? `document.querySelector(${JSON.stringify(container)})` : 'document.scrollingElement || document.documentElement'};
    if (!node) return null;
    const before = node.scrollTop;
    node.scrollTo({ top: before + ${step}, left: node.scrollLeft, behavior: 'instant' });
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      moved: node.scrollTop - before,
      top: Math.round(node.scrollTop),
      height: Math.round(node.scrollHeight),
      atBottom: node.scrollHeight - node.scrollTop - node.clientHeight <= 2
    }))));
  })()`
}
