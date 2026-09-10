import { describe, expect, it } from 'vitest'
import { rewritePreviewBody } from './previewProxy.js'
import { rewritePreviewModules, rewritePreviewImportMap } from './previewModules.js'

const base = new URL('https://project.example/assets/main.js')
const proxy = (value: string, relative = base): string => '/api/preview?url=' + encodeURIComponent(new URL(value, relative).href)
const rewrite = (code: string): string => rewritePreviewModules(code, base, proxy)

describe('Web Reader: импорты сборок приложения', () => {
  it('сохраняет комментарии с примерами импортов', () => {
    const code = '// import "./example.js"\n/* export * from "./example.js" */'
    expect(rewrite(code)).toBe(code)
  })
  it('сохраняет строковые литералы с текстом from/import', () => {
    const code = `const example = "from './example.js'"; const html = 'import("./example.js")';`
    expect(rewrite(code)).toBe(code)
  })
  it('сохраняет регулярные выражения с импортоподобным текстом', () => {
    const code = 'const pattern = /from "\\.\\/example.js"/;'
    expect(rewrite(code)).toBe(code)
  })
  it('не переписывает текст template literal, но обрабатывает настоящий import внутри выражения', () => {
    expect(rewrite('const hint = `import "./example.js"`;')).toBe('const hint = `import "./example.js"`;')
    expect(rewrite('const text = `${import("./real.js")}`;')).toContain(proxy('./real.js'))
  })
  it('обрабатывает комментарии между import и адресом', () => {
    expect(rewrite('import /* chunk */ "./app.js";')).toContain(`import /* chunk */ "${proxy('./app.js')}"`)
    expect(rewrite('const load = () => import(/* lazy */ "./lazy.js");')).toContain(proxy('./lazy.js'))
  })
  it('декодирует экранированные и статические template-адреса', () => {
    expect(rewrite(String.raw`import './\u0061pp.js';`)).toContain(proxy('./app.js'))
    expect(rewrite('const load = () => import(`./lazy.js`);')).toContain(proxy('./lazy.js'))
  })
  it('переписывает абсолютные HTTP/HTTPS импорты и реэкспорты', () => {
    expect(rewrite('import "https://cdn.example/lib.js"; export * from "http://cdn.example/more.js";')).toContain(proxy('https://cdn.example/lib.js'))
    expect(rewrite('export * from "http://cdn.example/more.js";')).toContain(proxy('http://cdn.example/more.js'))
  })
  it('переписывает JavaScript публичного сайта без алиаса машины', () => {
    expect(rewritePreviewBody(Buffer.from('import \"./app.js\"'), 'text/javascript', base).toString()).toContain(proxy('./app.js'))
  })
  it('сохраняет import attributes и не ломает ещё не поддерживаемый синтаксис', () => {
    expect(rewrite('import data from "./data.json" with { type: "json" };')).toContain(`"${proxy('./data.json')}" with { type: "json" }`)
    expect(rewrite('this is not JavaScript')).toBe('this is not JavaScript')
  })
  it('переписывает явные адреса import map, не меняя bare имена и метаданные', () => {
    const source = JSON.stringify({ imports: { lib: './lib.js', 'https://cdn.example/x.js': './x.js' }, metadata: '<example>' })
    const map = JSON.parse(rewritePreviewImportMap(source, base, proxy))
    expect(map.imports.lib).toBe(proxy('./lib.js'))
    expect(map.imports[proxy('https://cdn.example/x.js')]).toBe(proxy('./x.js'))
    expect(map.metadata).toBe('<example>')
  })
  it('загружает ресурс new URL относительно исходного адреса модуля', () => {
    const code = 'const img = new URL("./logo.svg", import.meta.url); const unrelated = new URL("./x", other);'
    expect(rewrite(code)).toContain(`new URL("${proxy('./logo.svg')}", import.meta.url)`)
    expect(rewrite(code)).toContain('new URL("./x", other)')
  })
})
