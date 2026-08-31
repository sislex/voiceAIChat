// Компактная проверка доступности для этого пакета. Полный хелпер приложения
// (packages/ui/src/test/a11y.ts) сюда не тянем: модуль обязан собираться и
// проверяться отдельно от хоста, поэтому у него свой минимальный набор правил.
import axe, { type ElementContext, type Result } from 'axe-core'

/** В jsdom эти правила физически непроверяемы: нет стилей и геометрии. */
const DISABLED = {
  'color-contrast': { enabled: false },
  'color-contrast-enhanced': { enabled: false },
  'target-size': { enabled: false },
  'scrollable-region-focusable': { enabled: false },
  // Тест рендерит фрагмент экрана, а не страницу: ориентиров и <h1> в нём нет.
  region: { enabled: false },
  'page-has-heading-one': { enabled: false },
  'html-has-lang': { enabled: false },
  'document-title': { enabled: false },
  'landmark-one-main': { enabled: false }
}

export async function expectNoViolations(container: ElementContext = document.body): Promise<void> {
  const { violations } = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    rules: DISABLED,
    resultTypes: ['violations'],
    elementRef: false
  })
  if (violations.length === 0) return
  throw new Error(`axe нашёл ${violations.length} нарушени(я):\n${format(violations)}`)
}

function format(violations: Result[]): string {
  return violations
    .map((v) => `  [${v.impact ?? 'n/a'}] ${v.id}: ${v.help}\n${v.nodes.slice(0, 3).map((n) => `      ${n.html}`).join('\n')}`)
    .join('\n')
}
