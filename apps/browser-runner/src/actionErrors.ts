/**
 * Why the action did not work, in words the model can act on.
 *
 * Playwright says "locator.click: Timeout 5000ms exceeded" and attaches a call
 * log; the model saw only the first line of that and retried the same click.
 * Each of these failures has a different fix — scroll to the element, close the
 * modal that covers it, wait for it to become enabled, find it again after the
 * page re-rendered — and the fix is exactly what was missing from the message.
 */

export type ActionFailureKind =
  | 'not-found'
  | 'ambiguous'
  | 'covered'
  | 'disabled'
  | 'detached'
  | 'navigated'
  | 'timeout'
  | 'other'

export interface ActionFailure {
  kind: ActionFailureKind
  /** Причина словами — то, что человек сказал бы, глядя на экран. */
  reason: string
  /** Что делать дальше: одно конкретное действие, а не список возможностей. */
  advice?: string
}

/** Разбор сообщения Playwright: у каждой беды свой следующий шаг. */
export function classifyActionError(raw: string): ActionFailure {
  const message = raw.split('\n')[0]
  const lower = raw.toLowerCase()
  if (lower.includes('stale_element_ref') || lower.includes('element is not attached')) {
    return {
      kind: 'detached',
      reason: 'Элемент исчез со страницы между поиском и действием: страница перерисовалась.',
      advice: 'Найди элемент заново (find или read) и повтори действие.'
    }
  }
  if (lower.includes('strict mode violation') || lower.includes('найдено несколько')) {
    return {
      kind: 'ambiguous',
      reason: 'Под селектор попадает несколько элементов, и непонятно, какой имелся в виду.',
      advice: 'Уточни селектор через find — он вернёт селектор конкретного узла.'
    }
  }
  if (lower.includes('intercepts pointer events') || lower.includes('element is outside of the viewport')) {
    return {
      kind: 'covered',
      reason: 'В точке клика лежит другой элемент: страницу перекрывает шапка, подсказка или модальное окно.',
      advice: 'Посмотри measure — он назовёт перекрывающий узел; закрой его или прокрути к цели (scrollTo).'
    }
  }
  if (lower.includes('element is not enabled') || lower.includes('not editable')) {
    return {
      kind: 'disabled',
      reason: 'Элемент выключен или не принимает ввод.',
      advice: 'Дождись его готовности: wait с enabled: true или editable: true.'
    }
  }
  if (lower.includes('execution context was destroyed') || lower.includes('navigation')) {
    return {
      kind: 'navigated',
      reason: 'Страница ушла на другой адрес прямо во время действия.',
      advice: 'Проверь, куда попал (status), и повтори действие на новой странице.'
    }
  }
  if (lower.includes('timeout') && (lower.includes('waiting for') || lower.includes('exceeded'))) {
    return {
      kind: 'timeout',
      reason: 'Элемент не появился (или не стал доступным) за отведённое время.',
      advice: 'Проверь, что страница догрузилась: wait с network: "idle", затем найди элемент заново.'
    }
  }
  // Селектор попадает внутрь фразы («Элемент #save не найден»), поэтому ищем
  // сам признак отсутствия, а не точную формулировку.
  if (/не найден/.test(lower)) {
    return {
      kind: 'not-found',
      reason: 'Такого элемента на странице нет — по крайней мере видимого.',
      advice: 'Найди его через find по видимому тексту; если лента длинная, сначала scroll-until.'
    }
  }
  return { kind: 'other', reason: message }
}

/**
 * Похожие элементы: когда цели нет, «нет элемента» — половина ответа. Человек в
 * этот момент смотрит на экран и видит кнопку с чуть другой подписью; модель
 * должна получить те же кандидаты, а не гадать.
 */
export function candidatesScript(text: string | null, selector: string | null, limit: number): string {
  const needle = (text ?? selector ?? '').replace(/^[.#]/, '').toLowerCase()
  return `(() => {
    const needle = ${JSON.stringify(needle)};
    if (!needle) return [];
    const clean = value => (value || '').trim().replace(/\\s+/g, ' ');
    const score = value => {
      const candidate = clean(value).toLowerCase();
      if (!candidate) return 0;
      if (candidate === needle) return 3;
      if (candidate.includes(needle) || needle.includes(candidate)) return 2;
      // Общее начало слова: «Сохранить» и «Сохранить как» человек считает
      // одним и тем же, а строгое сравнение — разными.
      const head = needle.slice(0, Math.max(4, Math.floor(needle.length / 2)));
      return head && candidate.includes(head) ? 1 : 0;
    };
    const seen = [];
    for (const node of document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="menuitem"]')) {
      const label = clean(node.innerText || node.value || node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.getAttribute('title'));
      const points = score(label);
      if (!points) continue;
      const box = node.getBoundingClientRect();
      seen.push({
        text: label.slice(0, 80),
        tag: node.localName,
        points,
        visible: box.width > 0 && box.height > 0,
        ...(node.disabled === true ? { disabled: true } : {})
      });
    }
    return seen.sort((a, b) => b.points - a.points).slice(0, ${limit}).map(({ points, ...item }) => item);
  })()`
}
