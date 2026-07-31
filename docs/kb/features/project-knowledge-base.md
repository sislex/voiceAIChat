---
id: project-knowledge-base
title: База знаний проекта
kind: feature
updated: 2026-07-27
areas:
  - docs/kb
  - scripts/kb-search.mjs
  - apps/server/src/kb
  - packages/shared/src/kb.ts
  - packages/ui/src/components/KnowledgeBase.tsx
symbols:
  - FileKnowledgeBaseService
  - LlmKbReranker
  - KnowledgeBase
protocols:
  - GET /api/kb/status
  - GET /api/kb/topics
  - GET /api/kb/search
  - GET /api/kb/context
  - GET /api/kb/documents/:id
tags:
  - documentation
  - search
  - bm25
  - agents
aliases:
  - KB
  - знания проекта
  - поиск по проекту
packages:
  - shared
  - server
  - ui
related:
  - kb-workflow
  - kb-usage
  - llm
  - protocol
---

# База знаний проекта

## Назначение

База знаний быстро отвечает, как реализованы фичи voiceAIChat, где находятся ключевые символы и какие протоколы используются. Markdown в `docs/kb` остаётся единственным источником истины и проходит обычный Git review. UI работает только на чтение.

## Поток поиска

Серверный `FileKnowledgeBaseService` рекурсивно читает разрешённые Markdown-документы, разбивает их по заголовкам и строит индекс в памяти. Точные совпадения `symbols`, `aliases`, `areas` и `protocols` получают приоритет, затем применяется BM25-подобное ранжирование текста.

Если точного сильного результата нет и включён `VC_KB_RERANK_PROVIDER`, до 15 lexical-кандидатов получает `LlmKbReranker`. Он запускает отдельную сессию Claude/Codex без инструментов и возвращает только разрешённые chunk ID. Ошибка CLI оставляет исходную BM25-выдачу.

## Контекст агента

`GET /api/kb/context` и `npm run kb:context -- "задача"` возвращают максимум пять небольших разделов в пределах token budget. `TurnManager` автоматически добавляет bundle только для разговора с `kbContextMode=auto` и только при высокой уверенности. `manual` фонового контекста не добавляет, но выдаёт модели инструменты `mcp__kb__*` (`off` — ничего); каждое обращение попадает в телеметрию панели «Использование БЗ» — см. `features/kb-usage.md`.

## API и UI

Маршруты `/api/kb/*` защищены общим Bearer guard. Контракт находится в `packages/shared/src/kb.ts`, web-мост — в `packages/ui/src/remote/httpApi.ts`. Пункт «База знаний» в Sidebar открывает общий `ToolFrame`: фильтры, результаты с объяснением совпадения и Markdown-документ со связанными файлами.

## Подготовка перед сборкой

`npm run kb:prepare` атомарно создаёт `generated/kb/{manifest,documents,lexical-index}.json`. `npm run kb:verify-prepared` проверяет content hash. Сетевые вызовы и CLI при подготовке не используются; reranking выполняется только runtime.

Агентские команды: `kb:search`, `kb:context`, `kb:impact`. Последняя сопоставляет Git diff с `areas` и рекомендует статьи для сверки, но не блокирует работу.

## Как расширять

Новая пользовательская фича получает карточку `docs/kb/features/<id>.md` с `areas`, `symbols`, `protocols`, aliases и связанными статьями. Большие фрагменты кода в KB не копируются: документ объясняет поток данных и указывает источник.

Настоящий vector search можно позднее добавить за интерфейсом semantic search, не меняя Markdown, REST-ответы или UI. В MVP используется BM25 с выборочным LLM-reranking, потому что Claude/Codex CLI не предоставляют embeddings.

## Тесты

`apps/server/src/kb/service.test.ts` проверяет точный символ, русский lexical-поиск, budget и reranking. `KnowledgeBase.dom.test.tsx` проверяет поиск, открытие документа и связанные файлы. Общие server/UI гейты подтверждают совместимость REST и IPC.
