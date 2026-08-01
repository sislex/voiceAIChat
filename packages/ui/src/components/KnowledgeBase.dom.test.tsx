import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { KbDocument } from '@shared/kb'
import { createFakeApi } from '../test/fakeApi'
import { KnowledgeBase } from './KnowledgeBase'

describe('KnowledgeBase', () => {
  it('ищет раздел и открывает read-only Markdown-документ', async () => {
    const api = createFakeApi(); const doc: KbDocument = { id:'turns',title:'Ходы модели',kind:'feature',scope:'usage',tags:['llm'],packages:['server'],freshness:'current',sourcePath:'docs/kb/features/turns.md',updated:'2026-07-27',body:'# Ходы модели\n\nОтвет сохраняет сервер.',symbols:['createTurnManager'],protocols:['claude.active'],areas:['apps/server/src/turns.ts'],related:[],headings:[] }
    api['kb:status'] = async () => ({ available:true,mode:'source',searchMode:'hybrid',version:'abc',createdAt:'now',documents:1,chunks:1,staleDocuments:0 })
    api['kb:topics'] = async () => [{ id:doc.id,title:doc.title,kind:doc.kind,scope:doc.scope,tags:doc.tags,packages:doc.packages,freshness:doc.freshness,sourcePath:doc.sourcePath }]
    api['kb:search'] = async () => [{ documentId:'turns',chunkId:'turns#life',title:'Ходы модели',heading:'Жизненный цикл',excerpt:'Ответ переживает обрыв.',score:4,matchTypes:['lexical'],explanation:'Полнотекстовое совпадение',freshness:'current',sourcePath:doc.sourcePath,anchor:'life',symbols:doc.symbols,relatedFiles:doc.areas }]
    api['kb:document'] = async () => doc
    render(<KnowledgeBase api={api} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Поиск по базе знаний'), { target:{ value:'обрыв' } })
    await waitFor(() => expect(screen.getByText('Жизненный цикл')).toBeTruthy())
    fireEvent.click(screen.getByText('Ходы модели'))
    await waitFor(() => expect(screen.getByText('Ответ сохраняет сервер.')).toBeTruthy())
    expect(screen.getByText('apps/server/src/turns.ts')).toBeTruthy()
  })
  it('три раздела: проектные знания ищутся по выбранному проекту', async () => {
    const api = createFakeApi()
    const projects = [
      { id: 'p1', name: 'Магазин' },
      { id: 'p2', name: 'Портал' }
    ]
    api['projects:list'] = async () => projects.map((p) => ({ ...p, description: '', gitUrl: null, technologies: [], skills: [], defaultSkills: { epic: [], story: [], task: [] }, createdBy: 'admin', createdAt: 0, updatedAt: 0, role: 'owner' as const, commitPolicy: 'agent_commits' as const, mergeTransport: 'local' as const, agentPlanApprovalMode: 'manual' as const, ciReuseStrategy: 'fail' as const, doneRetentionDays: null }))
    const asked: Array<{ scope?: string; projectId?: string | null }> = []
    api['kb:topics'] = async (arg) => {
      asked.push({ scope: arg?.scope, projectId: arg?.projectId ?? null })
      return arg?.scope === 'project' && arg.projectId === 'p2'
        ? [{ id: 'p2-dev', title: 'Разработка: Портал', kind: 'subsystem', scope: 'project', projectId: 'p2', tags: [], packages: [], freshness: 'unknown', sourcePath: 'проект/p2/p2-dev' }]
        : []
    }
    render(<KnowledgeBase api={api} onClose={() => {}} />)
    // Вкладки — три раздела; по умолчанию открыто «Использование».
    for (const label of ['Использование', 'Настройки пользователя', 'Разработка проекта']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    await waitFor(() => expect(asked[0]?.scope).toBe('usage'))

    fireEvent.click(screen.getByRole('button', { name: 'Разработка проекта' }))
    const select = await screen.findByLabelText('Проект')
    fireEvent.change(select, { target: { value: 'p2' } })
    await waitFor(() => expect(screen.getAllByText('Разработка: Портал').length).toBeGreaterThan(0))
    expect(asked.at(-1)).toEqual({ scope: 'project', projectId: 'p2' })
  })

  it('«Исследовать проект» запускает прогон и показывает его состояние', async () => {
    const api = createFakeApi()
    api['projects:list'] = async () => [{ id: 'p1', name: 'Магазин', description: '', gitUrl: null, technologies: [], skills: [], defaultSkills: { epic: [], story: [], task: [] }, createdBy: 'admin', createdAt: 0, updatedAt: 0, role: 'owner', commitPolicy: 'agent_commits', mergeTransport: 'local', agentPlanApprovalMode: 'manual', ciReuseStrategy: 'fail', doneRetentionDays: null }]
    const started: string[] = []
    api['kb:research'] = async ({ projectId }) => {
      started.push(projectId)
      return { projectId, state: 'running', startedBy: 'admin', startedAt: 1, finishedAt: null, documents: [], note: '', error: null }
    }
    render(<KnowledgeBase api={api} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Разработка проекта' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Исследовать проект' }))
    await waitFor(() => expect(started).toEqual(['p1']))
    expect(screen.getByText('Модель исследует репозиторий проекта…')).toBeTruthy()
  })

  it('в персональном разделе можно записать свою статью', async () => {
    const api = createFakeApi()
    const saved: Array<{ scope: string; title: string }> = []
    api['kb:saveDocument'] = async (draft) => {
      saved.push({ scope: draft.scope, title: draft.title })
      return { id: 'my-1', title: draft.title, kind: 'subsystem', scope: draft.scope, projectId: null, editable: true, tags: [], packages: [], freshness: 'unknown', sourcePath: 'мои знания/my-1', body: draft.body, symbols: [], protocols: [], areas: [], related: [], headings: [] }
    }
    render(<KnowledgeBase api={api} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Настройки пользователя' }))
    fireEvent.click(screen.getByRole('button', { name: 'Новая статья' }))
    fireEvent.change(screen.getByLabelText('Заголовок статьи'), { target: { value: 'Мои предпочтения' } })
    fireEvent.change(screen.getByLabelText('Текст статьи'), { target: { value: 'Отвечай кратко.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(saved).toEqual([{ scope: 'user', title: 'Мои предпочтения' }]))
    expect(await screen.findByText('Отвечай кратко.')).toBeTruthy()
  })

  it('documentId из адреса (#/kb/:id) открывает документ без поиска', async () => {
    const api = createFakeApi()
    const doc: KbDocument = { id:'protocol',title:'Протокол',kind:'protocol',scope:'usage',tags:[],packages:[],freshness:'current',sourcePath:'docs/kb/protocol.md',updated:'2026-07-27',body:'# Протокол\n\nКадры JSON.',symbols:[],protocols:[],areas:[],related:[],headings:[] }
    api['kb:document'] = async ({ id }) => (id === 'protocol' ? doc : null)
    render(<KnowledgeBase api={api} documentId="protocol" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Кадры JSON.')).toBeTruthy())
  })
})
