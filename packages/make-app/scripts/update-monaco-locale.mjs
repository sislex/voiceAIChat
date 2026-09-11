// Rebuild Make's editor-control catalog from the installed MIT-licensed Monaco distribution.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const directory = dirname(require.resolve('monaco-editor/package.json'))
const parse = (text) => ts.createSourceFile('messages.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
let russian
const visit = (node) => {
  if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) && node.left.name.text === '_VSCODE_NLS_MESSAGES' && ts.isArrayLiteralExpression(node.right)) {
    russian = node.right.elements.map((element) => element.text)
  }
  ts.forEachChild(node, visit)
}
visit(parse(readFileSync(join(directory, 'min/vs/nls.messages.ru.js'), 'utf8')))
if (!russian) throw new Error('Monaco Russian language data was not found')
const source = readFileSync(join(directory, 'dev/vs/editor/editor.main.js'), 'utf8')
const messages = {}
for (const match of source.matchAll(/\blocalize(?:2)?\(\s*(\d+)\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) {
  const statement = parse(match[2]).statements[0]
  if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) continue
  const english = statement.expression.text
  const translated = russian[Number(match[1])]
  if (!translated) continue
  const clean = (value) => value.replace(/&&/g, '').replace(/&(?=[A-Za-z\u0400-\u04ff])/g, '')
  messages[clean(english)] = clean(translated)
}
const { version } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
writeFileSync(new URL('../src/i18n/monaco.ru.json', import.meta.url), JSON.stringify({ version, messages }, null, 2) + '\n')
writeFileSync(new URL('../src/i18n/monaco.LICENSE.txt', import.meta.url), readFileSync(join(directory, 'LICENSE')))
console.log(`Updated ${Object.keys(messages).length} Monaco ${version} translations`)
