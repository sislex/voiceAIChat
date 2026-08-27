// Автогенерация сториз (roadmap-4 п.23): для компонента без `*.stories.tsx` собираем CSF-файл по его пропсам.
// Разбор типов — эвристический (interface/type XProps с полями `name?: тип`), этого хватает для сгенерированного кода.
import { componentExports } from './makeAutoImport'

export interface StoryProp { name: string; type: string; optional: boolean; literals: string[] }

/** Компоненты проекта без сториз: tsx/jsx вне точек входа, сториз и тестов, у которых нет соседнего `<Имя>.stories.*`. */
export function componentsWithoutStories(paths: string[]): string[] {
  const set = new Set(paths)
  return paths.filter((p) => {
    if (!/\.(tsx|jsx)$/i.test(p) || /\.(stories|test)\.(tsx|jsx)$/i.test(p)) return false
    const base = p.replace(/\.(tsx|jsx)$/i, '')
    if (/(^|\/)(main|App|index)$/.test(base)) return false
    return !set.has(`${base}.stories.tsx`) && !set.has(`${base}.stories.jsx`)
  })
}

/** Пропсы из `interface XProps { … }` или `type XProps = { … }`; литеральные union-типы дают набор вариантов. */
export function parseProps(source: string): StoryProp[] {
  const m = /(?:interface|type)\s+\w*Props\s*(?:=\s*)?\{([\s\S]*?)\n\}/.exec(source)
  if (!m) return []
  const out: StoryProp[] = []
  for (const raw of m[1]!.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim().replace(/[;,]$/, '')
    const f = /^(\w+)(\?)?\s*:\s*(.+)$/.exec(line)
    if (!f) continue
    const type = f[3]!.trim()
    const literals = [...type.matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2] ?? '')
    out.push({ name: f[1]!, type, optional: Boolean(f[2]), literals })
  }
  return out
}

function sampleValue(p: StoryProp): string | null {
  if (p.literals.length) return `"${p.literals[0]}"`
  if (/^\(.*\)\s*=>/.test(p.type) || /^\w*Handler\b|^\(\)/.test(p.type)) return '{() => {}}'
  if (/^string$/i.test(p.type)) return `"${/title|name|label|text|children/i.test(p.name) ? 'Пример' : p.name}"`
  if (/^number$/i.test(p.type)) return '{1}'
  if (/^boolean$/i.test(p.type)) return '{true}'
  if (/ReactNode|JSX\.Element/.test(p.type)) return '"Содержимое"'
  return null
}

/** Исходник `<Имя>.stories.tsx`: Default со всеми обязательными пропсами и по стори на каждый литерал первого union-пропса. */
export function generateStoriesSource(path: string, source: string): { path: string; content: string; component: string } | null {
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.(tsx|jsx)$/i, '')
  const exp = componentExports(path, source)
  const component = exp.names.includes(base) ? base : exp.names[0] ?? (exp.hasDefault ? base : null)
  if (!component) return null
  const props = parseProps(source)
  const attrs = props.map((p) => { const v = sampleValue(p); return v && (!p.optional || p.literals.length || /^string|^boolean/.test(p.type)) ? `${p.name}=${v}` : null }).filter(Boolean) as string[]
  const importLine = exp.names.includes(component) ? `import { ${component} } from './${base}'` : `import ${component} from './${base}'`
  const lines = [importLine, '', `export default { title: '${component}', component: ${component} }`, '', `export const Default = () => <${component}${attrs.length ? ' ' + attrs.join(' ') : ''} />`]
  const variant = props.find((p) => p.literals.length > 1)
  if (variant) {
    for (const lit of variant.literals.slice(0, 4)) {
      const name = lit.replace(/[^A-Za-z0-9]/g, ' ').split(' ').filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('') || 'Variant'
      const others = attrs.filter((a) => !a.startsWith(`${variant.name}=`))
      lines.push(`export const ${name} = () => <${component} ${[`${variant.name}="${lit}"`, ...others].join(' ')} />`)
    }
  }
  return { path: path.replace(/\.(tsx|jsx)$/i, '.stories.tsx'), content: lines.join('\n') + '\n', component }
}
