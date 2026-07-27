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
  it('BM25 ищет русское описание и ограничивает context budget', async () => { const kb = new FileKnowledgeBaseService(fixture()); const found = await kb.search({ query: 'обрыв websocket сохраняет ответ' }); expect(found[0].documentId).toBe('model-turns'); expect((await kb.context('обрыв websocket', 200)).estimatedTokens).toBeLessThanOrEqual(200) })
  it('выборочно вызывает reranker для неоднозначной выдачи и проверяет ids', async () => { const rerank = { rerank: vi.fn(async (_q, candidates) => [candidates.at(-1)!.chunkId, 'unknown']) }; const kb = new FileKnowledgeBaseService(fixture(), rerank); const found = await kb.search({ query: 'websocket' }); expect(rerank.rerank).toHaveBeenCalledOnce(); expect(found[0].matchTypes).toContain('semantic') })
})
