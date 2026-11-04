import { describe, expect, it } from 'vitest'
import { indexBody, loadDocument, markdownHeadings, searchDocuments } from './engine.js'
import type { KbFiles } from './ports.js'

const meta = {
  id: 'doc',
  title: 'Документ',
  kind: 'feature' as const,
  scope: 'usage' as const,
  sourcePath: 'docs/kb/doc.md'
}

describe('Markdown index', () => {
  it('игнорирует заголовки в fenced code и делает повторные anchors уникальными', () => {
    const body = [
      '# Документ',
      '',
      '```md',
      '## Не раздел',
      '```',
      '',
      '## Повтор',
      'Первый.',
      '',
      '## Повтор',
      'Второй.'
    ].join('\n')
    expect(markdownHeadings(body).map(({ title, anchor }) => ({ title, anchor }))).toEqual([
      { title: 'Документ', anchor: 'документ' },
      { title: 'Повтор', anchor: 'повтор' },
      { title: 'Повтор', anchor: 'повтор-2' }
    ])
    expect(indexBody(meta, body).chunks.map((chunk) => chunk.id)).toEqual([
      'doc#документ',
      'doc#повтор',
      'doc#повтор-2'
    ])
  })

  it('treats a line starting with inline code as prose, not as an unclosed fence', () => {
    const body = [
      '# Document',
      '',
      '```` ```questions ```` block is rendered by the column.',
      '',
      '## After inline code',
      'Text.',
      '',
      '````md',
      '```',
      '## Not a section',
      '````',
      '',
      '## After nested fence',
      'Text.'
    ].join('\n')
    expect(markdownHeadings(body).map(({ title }) => title)).toEqual([
      'Document',
      'After inline code',
      'After nested fence'
    ])
  })

  it('назначает точное metadata-совпадение одному наиболее релевантному разделу', async () => {
    const indexed = indexBody(
      { ...meta, symbols: ['UniqueSymbol'] },
      '# Документ\n\nВведение.\n\n## Первый\n\nАльфа.\n\n## Второй\n\nБета.'
    )
    const results = await searchDocuments([indexed], { query: 'UniqueSymbol', limit: 10 })
    expect(results).toHaveLength(1)
    expect(results[0].matchTypes).toContain('symbol')
  })

  it('не объявляет файловую статью свежей только из-за updated во frontmatter', () => {
    const path = '/repo/docs/kb/topic.md'
    const files: KbFiles = {
      exists: () => true,
      listMarkdown: () => [path],
      read: () => '---\nupdated: 2026-11-01\n---\n# Topic\n\nBody'
    }
    expect(loadDocument('/repo/docs/kb', path, 'core', 'docs/kb', files).document.freshness).toBe('unknown')
  })
})
