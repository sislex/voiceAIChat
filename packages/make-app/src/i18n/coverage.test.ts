import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { MAKE_STARTER_GROUPS, MAKE_STARTER_PROMPTS, MAKE_TEMPLATES } from '@shared/make'
import { createMakeTextTranslator, makeSystemMessages } from '@voicechat/make-contracts/localization'
import { makeMessages } from './messages'
import { commonMakeMessages } from './commonMessages'
import { makeMockPrompt } from '@shared/makeMockPrompt'
import { snippetsFor } from '../../../ui-foundation/src/components/code/monacoSnippets'

it('covers every starter and template description supplied by shared project metadata', () => {
  const translate = createMakeTextTranslator({ ...makeSystemMessages, ...makeMessages, ...commonMakeMessages })
  const messages = [
    ...Object.values(MAKE_STARTER_GROUPS),
    ...MAKE_STARTER_PROMPTS.flatMap((item) => [item.title, item.prompt]),
    ...MAKE_TEMPLATES.flatMap((item) => [item.title, item.description])
  ]
  for (const message of messages) expect(translate(message, 'en'), message).not.toMatch(/[\u0400-\u04ff]/u)
})

it('keeps interface text in catalogs while allowing code examples and language endonyms', () => {
  const directory = fileURLToPath(new URL('../components/', import.meta.url))
  const technical = new Set(['&lt;', '&gt;', 'Русский', 'English', '$body', 'make_remember', 'Aa', 'JSON', '&lt;img&gt;', 'npm install', 'npm run dev', '--no-open', '--ci', 'npm run -w @voicechat/ui storybook --', ':root'])
  const violations: string[] = []
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.tsx') && !/\.(test|stories)\./.test(name))) {
    const source = ts.createSourceFile(file, readFileSync(directory + file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const walk = (node: ts.Node): void => {
      if (ts.isJsxText(node) && /[A-Za-z\u0400-\u04ff]/.test(node.text) && !technical.has(node.text.trim())) violations.push(`${file}: ${node.text.trim()}`)
      if (ts.isStringLiteralLike(node) && /[\u0400-\u04ff]/.test(node.text)) violations.push(`${file}: ${node.text}`)
      ts.forEachChild(node, walk)
    }
    walk(source)
  }
  expect(violations).toEqual([])
})

it('translates generated instructions and snippet hints while preserving user data and inserted code', () => {
  const translate = createMakeTextTranslator({ ...makeSystemMessages, ...makeMessages, ...commonMakeMessages })
  const result = makeMockPrompt('orders: name, amount', { count: 8, translate: (text) => translate(text, 'en') })
  expect(result.prompt).not.toMatch(/[\u0400-\u04ff]/u)
  expect(result.prompt).toContain('orders: name, amount')
  expect(result.prompt).toContain('fetch("api/orders")')
  expect(result.prompt).toContain('8')
  for (const language of ['typescript', 'css']) {
    const original = snippetsFor(language)
    for (const [index, snippet] of snippetsFor(language, (text) => translate(text, 'en')).entries()) {
      expect(snippet.label + snippet.detail).not.toMatch(/[\u0400-\u04ff]/u)
      expect(snippet.body).toBe(original[index].body)
    }
  }
})
