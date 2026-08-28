import { describe, expect, it } from 'vitest'
import { lintMakeFile } from './makeLint'

describe('lintMakeFile', () => {
  it('JSX/TS: console, var, ==, img без alt, map без key; комментарии не считаются', () => {
    const src = [
      "console.log('x')",            // 1
      '// console.log(skip)',        // 2
      'var a = 1',                   // 3
      'if (a == 1) {}',              // 4
      '<img src="a.png" />',         // 5
      '<img src="a.png" alt="" />',  // 6
      'items.map((it) => <li key={it}>{it}</li>)', // 7
      'items.map((it) => <li>{it}</li>)', // 8 — key нет ни в строке, ни в следующей
      'const ok = a === 1'
    ].join('\n')
    const rules = lintMakeFile('src/App.tsx', src).map((i) => `${i.line}:${i.rule}`)
    expect(rules).toEqual(['1:no-console', '3:no-var', '4:eqeqeq', '5:img-alt', '8:jsx-key'])
  })
  it('CSS: !important, дубли свойств, битый hex, пустое правило', () => {
    const css = [
      '.a { color: red !important; }',   // 1
      '.b {',                            // 2
      '  margin: 0;',                    // 3
      '  color: #12345;',                // 4
      '  margin: 4px;',                  // 5
      '}',                               // 6
      '.c {',                            // 7
      '}',                               // 8
      '.d { color: #fff; }'
    ].join('\n')
    const rules = lintMakeFile('styles.css', css).map((i) => `${i.line}:${i.rule}`)
    expect(rules).toEqual(['1:no-important', '4:color-hex', '5:no-duplicate-property', '7:no-empty-block'])
  })
  it('другие расширения — без замечаний', () => {
    expect(lintMakeFile('index.html', '<img src=x>')).toEqual([])
  })
})
