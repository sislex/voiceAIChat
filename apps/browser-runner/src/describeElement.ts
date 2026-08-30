// Описание элемента под точкой кадра.
//
// Клик в панели координатный, а шаг сценария обязан быть селекторным: запись,
// сделанная координатами, рассыплется от любого сдвига вёрстки. Поэтому перед
// кликом раннер спрашивает страницу, что под курсором, и строит устойчивый
// селектор.
//
// Тело функции исполняется в браузере, поэтому оно возвращается строкой: у
// пакета нет библиотеки DOM (это Node-сервис), и типы браузера тут недоступны.

/**
 * Порядок предпочтений осознанный: `data-testid` ставят ради тестов и не
 * меняют при правках вёрстки, `id` тоже стабилен, `aria-label` переживает смену
 * классов, роль с именем — язык доступности. Путь по тегам — последнее
 * средство: он ломается от вставки соседнего узла, и об этом честно сообщается
 * полем `stability`.
 */
export function describeElementScript(x: number, y: number): string {
  return `(() => {
    const doc = document
    const hit = doc.elementFromPoint(${x}, ${y})
    if (!hit) return null
    // elementFromPoint отдаёт самый верхний узел — это <span> внутри кнопки.
    // Кликают по кнопке, и её же обычно помечают data-testid, поэтому
    // поднимаемся к ближайшему опознаваемому предку.
    const interactive = 'BUTTON A INPUT SELECT TEXTAREA LABEL'.split(' ')
    const known = (el) => Boolean(el.getAttribute('data-testid') || el.id || interactive.indexOf(el.tagName) >= 0)
    // Ищем ближайшего опознаваемого предка. Если такого нет — остаёмся на самом
    // узле: подъём «до упора» уводил бы к html и давал бессмысленный селектор.
    let node = hit
    let candidate = hit
    for (let up = 0; up < 4 && candidate && candidate.tagName !== 'BODY'; up++) {
      if (known(candidate)) { node = candidate; break }
      candidate = candidate.parentElement
    }
    const esc = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'))
    const testid = node.getAttribute('data-testid')
    const label = node.getAttribute('aria-label')
    const role = node.getAttribute('role')
    let selector = ''
    let stability = 'path'
    if (testid) { selector = '[data-testid="' + testid + '"]'; stability = 'testid' }
    else if (node.id) { selector = '#' + esc(node.id); stability = 'id' }
    else if (label) { selector = node.tagName.toLowerCase() + '[aria-label="' + label + '"]'; stability = 'label' }
    else if (role) { selector = node.tagName.toLowerCase() + '[role="' + role + '"]'; stability = 'role' }
    else {
      const parts = []
      let current = node
      while (current && current.nodeType === 1 && parts.length < 6) {
        const tag = current.tagName.toLowerCase()
        if (tag === 'html' || tag === 'body') break
        const parent = current.parentElement
        if (!parent) { parts.unshift(tag); break }
        const same = Array.prototype.filter.call(parent.children, (c) => c.tagName === current.tagName)
        parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(current) + 1) + ')' : tag)
        current = parent
      }
      // Клик мимо содержимого попадает в html/body: путь получался пустым, а
      // пустой селектор — это сломанный шаг сценария, а не «нет элемента».
      selector = parts.join(' > ') || node.tagName.toLowerCase()
    }
    const box = node.getBoundingClientRect()
    // Сколько узлов отвечает этому селектору: одинаковый aria-label может
    // встречаться десять раз, и записанный шаг молча кликнет по первому.
    // (Обратные кавычки в этом комментарии закрыли бы шаблонную строку.)
    let matches = 1
    try { matches = doc.querySelectorAll(selector).length } catch { matches = 0 }
    return {
      selector,
      stability,
      matches,
      tag: node.tagName.toLowerCase(),
      text: (node.innerText || node.value || node.getAttribute('placeholder') || '').trim().slice(0, 120),
      rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
    }
  })()`
}

/** Прокрутка к элементу: то же самое, но без описания. */
export function scrollToScript(selector: string): string {
  const quoted = JSON.stringify(selector)
  return `(() => {
    const node = document.querySelector(${quoted})
    if (!node) return false
    node.scrollIntoView({ block: 'center', inline: 'center' })
    return true
  })()`
}
