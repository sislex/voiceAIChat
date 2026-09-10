import { describe, expect, it } from 'vitest'
import { formatCode, prettierParserFor } from './formatCode'

describe('formatCode', () => {
  it('парсер по расширению; неизвестное — null', () => {
    expect(prettierParserFor('a.tsx')?.parser).toBe('typescript')
    expect(prettierParserFor('a.jsx')?.parser).toBe('babel')
    expect(prettierParserFor('index.html')?.parser).toBe('html')
    expect(prettierParserFor('x.png')).toBeNull()
  })
  it('форматирует JSX и CSS настройками проекта (без ; и с одинарными кавычками)', async () => {
    expect(await formatCode('a.jsx', 'const a = {x:1};export const B=()=> <div   className="a">{a.x}</div>;')).toBe("const a = { x: 1 }\nexport const B = () => <div className=\"a\">{a.x}</div>\n")
    expect(await formatCode('a.css', 'body{margin:0;padding:0}')).toBe('body {\n  margin: 0;\n  padding: 0;\n}\n')
    expect(await formatCode('a.txt', 'x')).toBeNull()
    await expect(formatCode('a.ts', 'const = ')).rejects.toThrow()
  })
})
