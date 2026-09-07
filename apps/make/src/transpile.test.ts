import { describe, expect, it } from 'vitest'
import { compileDiagnostics, rewriteRelativeImports, transpileForPreview } from './transpile'

describe('make transpile', () => {
  it('дополняет относительные импорты расширением существующего файла и не трогает остальные', () => {
    const exists = (p: string): boolean => ['src/App.jsx', 'src/lib/index.js', 'src/util.ts'].includes(p)
    const code = "import { App } from './App'\nimport lib from './lib'\nimport u from '../src/util'\nimport React from 'react'\nimport './styles.css'\nconst x = await import('./App')"
    const out = rewriteRelativeImports(code, 'src/main.jsx', exists)
    expect(out).toContain("from './App.jsx'")
    expect(out).toContain("from './lib/index.js'")
    expect(out).toContain("from '../src/util.ts'")
    expect(out).toContain("from 'react'")
    expect(out).toContain("import './styles.css'")
    expect(out).toContain("import('./App.jsx')")
  })

  // @testCase TC-06
  it('transpiles Angular standalone decorators with the same preview configuration', async () => {
    const source = `import { Component } from '@angular/core'
@Component({ selector: 'x-app', standalone: true, template: '<h1>ok</h1>' })
export class AppComponent {}`
    expect(await compileDiagnostics('src/main.ts', source)).toEqual([])
    const code = await transpileForPreview('angular', 'src/main.ts', source, 1, () => false)
    expect(code).toContain('AppComponent')
    expect(code).not.toContain('@Component')
  })

  it('JSX → ESM с automatic runtime; ошибка компиляции — модуль, бросающий понятную ошибку; кэш по rev', async () => {
    const ok = await transpileForPreview('c', 'a.jsx', 'export const A = () => <b>x</b>', 1, () => false)
    expect(ok).toContain('react/jsx-runtime')
    expect(ok).not.toContain('<b>')
    const bad = await transpileForPreview('c', 'b.jsx', 'export const = <', 1, () => false)
    expect(bad).toMatch(/^throw new Error\("Ошибка компиляции b\.jsx/)
    const cached = await transpileForPreview('c', 'a.jsx', 'export const A = 1', 1, () => false)
    expect(cached).toBe(ok)
    const fresh = await transpileForPreview('c', 'a.jsx', 'export const A = 1', 2, () => false)
    expect(fresh).toContain('A = 1')
  })
})
