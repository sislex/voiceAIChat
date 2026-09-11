import { getMakeLocale, mt } from '../i18n'
import russianAxe from 'axe-core/locales/ru.json'
// Make preview accessibility (item 13): lazily inject axe-core as text into the same-origin iframe
// via Vite ?raw, avoiding its roughly 570 KB cost until needed. Run it in the preview document and
// return compact violations. Using the same axe version as package tests keeps results aligned with
// the gates.
export interface A11yViolation {
  id: string
  impact: 'minor' | 'moderate' | 'serious' | 'critical'
  help: string
  helpUrl: string
  nodes: number
  /** Selector of the first affected node for locating it in the preview. */
  target: string
}

export function a11yHelp(violation: A11yViolation): string {
  if (getMakeLocale() !== 'ru') return violation.help
  return (russianAxe.rules as Record<string, { help: string }>)[violation.id]?.help ?? violation.help
}

export function a11yImpact(impact: A11yViolation['impact']): string {
  return mt(({ minor: 'impactMinor', moderate: 'impactModerate', serious: 'impactSerious', critical: 'impactCritical' } as const)[impact])
}

type AxeLike = { run: (ctx: Document, opts: object) => Promise<{ violations: Array<{ id: string; impact?: string; help: string; helpUrl: string; nodes: Array<{ target: string[] }> }> }> }

export async function runAxeInFrame(doc: Document): Promise<A11yViolation[]> {
  const win = doc.defaultView as (Window & { axe?: AxeLike }) | null
  if (!win) throw new Error(mt("previewHasNotLoaded"))
  if (!win.axe) {
    const { default: source } = await import('../../../../node_modules/axe-core/axe.min.js?raw')
    const script = doc.createElement('script')
    script.setAttribute('data-vc-make-axe', '')
    script.textContent = source
    doc.head.appendChild(script)
  }
  if (!win.axe) throw new Error(mt("axeFailedToLoadInThePreview"))
  const result = await win.axe.run(doc, { resultTypes: ['violations'], rules: { region: { enabled: false } } })
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 } as const
  return result.violations
    .map((v) => ({ id: v.id, impact: (v.impact ?? 'minor') as A11yViolation['impact'], help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length, target: v.nodes[0]?.target.join(' ') ?? '' }))
    .sort((a, b) => order[a.impact] - order[b.impact])
}

export function a11yPrompt(violations: A11yViolation[]): string {
  return mt("theAccessibilityCheckAxeFoundIssuesValueFixThem", { p0: violations.slice(0, 8).map((v) => mt("valueValueValueValueElementsEGValue", { p0: a11yImpact(v.impact), p1: a11yHelp(v), p2: v.id, p3: v.nodes, p4: v.target })).join('\n') })
}
