import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { KbDocument } from '@shared/kb'
import { createFakeApi } from '../test/fakeApi'
import { KnowledgeBase } from './KnowledgeBase'

describe('KnowledgeBase', () => {
  it('ищет раздел и открывает read-only Markdown-документ', async () => {
    const api = createFakeApi(); const doc: KbDocument = { id:'turns',title:'Ходы модели',kind:'feature',tags:['llm'],packages:['server'],freshness:'current',sourcePath:'docs/kb/features/turns.md',updated:'2026-07-27',body:'# Ходы модели\n\nОтвет сохраняет сервер.',symbols:['createTurnManager'],protocols:['claude.active'],areas:['apps/server/src/turns.ts'],related:[],headings:[] }
    api['kb:status'] = async () => ({ available:true,mode:'source',searchMode:'hybrid',version:'abc',createdAt:'now',documents:1,chunks:1,staleDocuments:0 })
    api['kb:topics'] = async () => [{ id:doc.id,title:doc.title,kind:doc.kind,tags:doc.tags,packages:doc.packages,freshness:doc.freshness,sourcePath:doc.sourcePath }]
    api['kb:search'] = async () => [{ documentId:'turns',chunkId:'turns#life',title:'Ходы модели',heading:'Жизненный цикл',excerpt:'Ответ переживает обрыв.',score:4,matchTypes:['lexical'],explanation:'Полнотекстовое совпадение',freshness:'current',sourcePath:doc.sourcePath,anchor:'life',symbols:doc.symbols,relatedFiles:doc.areas }]
    api['kb:document'] = async () => doc
    render(<KnowledgeBase api={api} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Поиск по базе знаний'), { target:{ value:'обрыв' } })
    await waitFor(() => expect(screen.getByText('Жизненный цикл')).toBeTruthy())
    fireEvent.click(screen.getByText('Ходы модели'))
    await waitFor(() => expect(screen.getByText('Ответ сохраняет сервер.')).toBeTruthy())
    expect(screen.getByText('apps/server/src/turns.ts')).toBeTruthy()
  })
  it('documentId из адреса (#/kb/:id) открывает документ без поиска', async () => {
    const api = createFakeApi()
    const doc: KbDocument = { id:'protocol',title:'Протокол',kind:'protocol',tags:[],packages:[],freshness:'current',sourcePath:'docs/kb/protocol.md',updated:'2026-07-27',body:'# Протокол\n\nКадры JSON.',symbols:[],protocols:[],areas:[],related:[],headings:[] }
    api['kb:document'] = async ({ id }) => (id === 'protocol' ? doc : null)
    render(<KnowledgeBase api={api} documentId="protocol" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Кадры JSON.')).toBeTruthy())
  })
})
