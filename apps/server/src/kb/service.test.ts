import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileKnowledgeBaseService } from './service.js'

const dirs: string[] = []
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'voicechat-kb-')); dirs.push(dir); mkdirSync(join(dir, 'features'))
  writeFileSync(join(dir, 'features/turns.md'), `---
id: model-turns
title: Ходы модели
kind: feature
updated: 2026-07-27
aliases:
  - фоновые ответы
symbols:
  - createTurnManager
areas:
  - apps/server/src/turns.ts
protocols:
  - claude.active
---
# Ходы модели

## Жизненный цикл

TurnManager хранит ход после обрыва WebSocket и сохраняет ответ в SQLite.
`)
  writeFileSync(join(dir, 'features/projects.md'), `---
id: projects
title: Проекты и канбан-доска
kind: subsystem
updated: 2026-07-27
symbols:
  - TaskModal
areas:
  - packages/ui/src/components/kanban
---
# Проекты и канбан-доска

## Фронтенд

Доска проекта рисует колонки, а подробности открываются модальным окном.
`)
  writeFileSync(join(dir, 'features/ci-runner.md'), `---
id: ci-runner
title: CI-раннер канбана
kind: feature
updated: 2026-07-27
---
# CI-раннер канбана

## Мерж без пересборки прода

Задача попадает в карточку учёта: карточка задачи с описанием пересборки,
модалка подтверждения и описание шага мержа. Карточка задачи закрывается,
когда прод пересобран, описание обновлено, модалка учёта скрыта.
`)
  writeFileSync(join(dir, 'protocol.md'), `---
id: protocol
title: Протокол
kind: protocol
updated: 2026-07-27
---
# Протокол

## WebSocket

События доставляются клиенту через один WebSocket.
`)
  return dir
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
describe('FileKnowledgeBaseService', () => {
  it('точный символ получает приоритет и разрешает auto context', async () => { const kb = new FileKnowledgeBaseService(fixture()); const found = await kb.search({ query: 'createTurnManager' }); expect(found[0]).toMatchObject({ documentId: 'model-turns', matchTypes: ['symbol'] }); const context = await kb.context('createTurnManager'); expect(context).toMatchObject({ confidence: 'high', autoInjectAllowed: true }) })
  it('поиск оставляет excerpt, а context добавляет полный текст раздела', async () => {
    const kb = new FileKnowledgeBaseService(fixture())
    const found = await kb.search({ query: 'обрыв websocket сохраняет ответ' })
    expect(found[0]).toMatchObject({ documentId: 'model-turns', matchTypes: ['lexical'] })
    expect(found[0]).not.toHaveProperty('text')
    const context = await kb.context('createTurnManager')
    expect(context.sections[0].text).toBe('TurnManager хранит ход после обрыва WebSocket и сохраняет ответ в SQLite.')
  })
  it('токены фразового запроса: путь внутри area и имя символа ставят раздел первым', async () => {
    const kb = new FileKnowledgeBaseService(fixture())
    const found = await kb.search({ query: 'карточка задачи: модалка описания `packages/ui/src/components/kanban/TaskModal.tsx` и TaskModal' })
    expect(found[0]).toMatchObject({ chunkId: 'projects#фронтенд', matchTypes: ['symbol', 'path'] })
    expect(found[0].explanation).toBe('Точное совпадение символа')
  })
  it('сокращённый запрос CHAT-50 поднимает projects#фронтенд в топ-3 мимо шумного раздела', async () => {
    const kb = new FileKnowledgeBaseService(fixture())
    const found = await kb.search({ query: 'карточка задачи модалка описание TaskModal' })
    expect(found.slice(0, 3).map((r) => r.chunkId)).toContain('projects#фронтенд')
    const hit = found.find((r) => r.chunkId === 'projects#фронтенд')!
    expect(hit.matchTypes).toContain('symbol')
  })
  it('выборочно вызывает reranker для неоднозначной выдачи и проверяет ids', async () => { const rerank = { rerank: vi.fn(async (_q, candidates) => [candidates.at(-1)!.chunkId, 'unknown']) }; const kb = new FileKnowledgeBaseService(fixture(), rerank); const found = await kb.search({ query: 'websocket' }); expect(rerank.rerank).toHaveBeenCalledOnce(); expect(found[0].matchTypes).toContain('semantic') })
})
