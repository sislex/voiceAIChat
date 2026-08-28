// Автоимпорт компонентов при вставке из библиотеки (roadmap-4 п.13): чистые функции над исходниками.
// Вставленный `src/components/X.tsx` сам по себе в приложении не появится — добавляем import в точку входа,
// чтобы ассистенту/пользователю оставалось только поставить `<X />` в разметку.

/** Именованные экспорты компонентов файла (PascalCase); default-экспорт → имя файла. */
export function componentExports(path: string, source: string): { names: string[]; hasDefault: boolean } {
  const names = new Set<string>()
  for (const m of source.matchAll(/export\s+(?:const|function|class)\s+([A-Z][A-Za-z0-9_]*)/g)) names.add(m[1]!)
  for (const m of source.matchAll(/export\s*\{([^}]+)\}/g)) for (const part of m[1]!.split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop()?.trim() ?? ''
    if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) names.add(name)
  }
  const hasDefault = /export\s+default\b/.test(source)
  void path
  return { names: [...names], hasDefault }
}

/** Относительный путь импорта из `from` в `to` без расширения: `src/App.tsx` → `src/components/X.tsx` = `./components/X`. */
export function relativeImportPath(from: string, to: string): string {
  const a = from.split('/').slice(0, -1), b = to.split('/')
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  const up = a.length - i
  const rest = b.slice(i).join('/').replace(/\.(tsx|ts|jsx|js)$/i, '')
  return (up === 0 ? './' : '../'.repeat(up)) + rest
}

export interface AutoImportSpec { path: string; names: string[]; defaultName?: string }

/**
 * Добавляет недостающие import-строки после последнего import точки входа (или в начало файла).
 * Уже импортированные модули (по спецификатору) не трогает. Возвращает новый исходник и список добавленных имён.
 */
export function addComponentImports(entryPath: string, entrySource: string, specs: AutoImportSpec[]): { source: string; added: string[] } {
  const added: string[] = []
  const lines: string[] = []
  for (const spec of specs) {
    if (spec.path === entryPath) continue
    const from = relativeImportPath(entryPath, spec.path)
    if (new RegExp(`from\\s+['"]${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[jt]sx?)?['"]`).test(entrySource)) continue
    const names = spec.names.filter((n) => !new RegExp(`\\b${n}\\b`).test(entrySource))
    const def = spec.defaultName && !new RegExp(`\\b${spec.defaultName}\\b`).test(entrySource) ? spec.defaultName : undefined
    if (!names.length && !def) continue
    const parts = [def, names.length ? `{ ${names.join(', ')} }` : undefined].filter(Boolean)
    lines.push(`import ${parts.join(', ')} from '${from}'`)
    added.push(...(def ? [def] : []), ...names)
  }
  if (!lines.length) return { source: entrySource, added }
  const src = entrySource.split('\n')
  let last = -1
  for (let i = 0; i < src.length; i++) if (/^\s*import\b/.test(src[i]!)) last = i
  src.splice(last + 1, 0, ...lines)
  return { source: src.join('\n'), added }
}

/** Точка входа проекта для автоимпорта: первая существующая из типичных. */
export function pickEntryFile(paths: string[]): string | null {
  for (const p of ['src/App.tsx', 'src/App.jsx', 'src/main.tsx', 'src/main.jsx', 'App.tsx', 'main.tsx']) if (paths.includes(p)) return p
  return null
}
