// Проверка доступности превью Make (п.13): axe-core инжектируется в same-origin iframe как текст
// (Vite `?raw`, лениво — 570 КБ), запускается внутри документа превью, наружу отдаём компактный список
// нарушений. Тот же axe, что в jsdom-тестах пакета, поэтому вердикты совпадают с нашими гейтами.
export interface A11yViolation {
  id: string
  impact: 'minor' | 'moderate' | 'serious' | 'critical'
  help: string
  helpUrl: string
  nodes: number
  /** Селектор первого затронутого узла — для «показать в превью». */
  target: string
}

type AxeLike = { run: (ctx: Document, opts: object) => Promise<{ violations: Array<{ id: string; impact?: string; help: string; helpUrl: string; nodes: Array<{ target: string[] }> }> }> }

export async function runAxeInFrame(doc: Document): Promise<A11yViolation[]> {
  const win = doc.defaultView as (Window & { axe?: AxeLike }) | null
  if (!win) throw new Error('Превью не загружено')
  if (!win.axe) {
    const { default: source } = await import('../../../../node_modules/axe-core/axe.min.js?raw')
    const script = doc.createElement('script')
    script.setAttribute('data-vc-make-axe', '')
    script.textContent = source
    doc.head.appendChild(script)
  }
  if (!win.axe) throw new Error('axe не загрузился в превью')
  const result = await win.axe.run(doc, { resultTypes: ['violations'], rules: { region: { enabled: false } } })
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 } as const
  return result.violations
    .map((v) => ({ id: v.id, impact: (v.impact ?? 'minor') as A11yViolation['impact'], help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length, target: v.nodes[0]?.target.join(' ') ?? '' }))
    .sort((a, b) => order[a.impact] - order[b.impact])
}

export function a11yPrompt(violations: A11yViolation[]): string {
  return `Проверка доступности (axe) нашла проблемы:\n${violations.slice(0, 8).map((v) => `- [${v.impact}] ${v.help} (${v.id}, ${v.nodes} элем., напр. ${v.target})`).join('\n')}\nИсправь их в разметке/стилях проекта. `
}
