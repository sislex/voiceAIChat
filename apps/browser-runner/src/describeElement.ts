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
    const node = doc.elementFromPoint(${x}, ${y})
    if (!node) return null
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
    return {
      selector,
      stability,
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
