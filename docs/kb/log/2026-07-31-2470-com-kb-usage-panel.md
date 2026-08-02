---
title: kb-usage-panel
date: 2026-07-31
machine: 2470-com
author: alexeyrozhnov
---

# kb-usage-panel

## Что сделано

- Контракты телеметрии БЗ в `packages/shared/src/kb.ts` (`KbUsageSource`,
  `KbUsageStatus`, `estimateKbTokens`, `KbUsageQuery/Report`,
  `KbProjectUsageReport`), кадр `kb.usage` и два REST-пути в `protocol.ts`,
  необязательные `chars`/`estimatedTokens`/`freshness` в
  `TurnRequestInfo.kbContext` (старые сообщения остаются валидными).
- Персистентность: `kb_usage_queries` + `kb_usage_sections` (`CREATE TABLE IF NOT
  EXISTS`, без миграций), методы `addKbUsage` / `attachKbUsageTurn` /
  `kbUsageLastSeq` / `kbUsageReport` / `kbUsageProjectReport`.
- Трекер `apps/server/src/kb/usage.ts`: `pending` только в WS-кадре, строка в БД
  появляется один раз терминальным методом; ни один метод не выбрасывает.
- MCP-сервер БЗ `apps/server/src/kb/kbMcp.ts`: `mcp__kb__search/document/topics`,
  токен хода через `kbToolBroker`, кап раздела 8000 символов, чистая `sectionOf`,
  константа хинта `kbToolHint(mode)`.
- `turns.ts`: обвязка авто-инъекции трекером, `turnId`, доделанный `manual`,
  `kbMcpUrl` вне ветки `remote`, освобождение токена во всех выходах хода.
- UI: мост `window.kb`, стор (`kbUsage`, `kbUsageByProject`, `kbStatus`), чистая
  логика `lib/kbUsage.ts`, панель `components/kb/*`, кнопка 📚 в тулбаре чата,
  маршрут `#/kb/:documentId`, ссылки в «Подробнее» ответа.

## Что выяснили (факты, которых не было в KB)

- `--append-system-prompt` у Claude CLI один на процесс: хинты remote и БЗ нужно
  склеивать, иначе второй флаг перетирает первый. Поэтому объявления
  `mcpServers`/`allowed`/хинтов поднялись выше ветки `if (req.remote)`.
- В headless `-p` флаг `--allowedTools` работает как allow-list автоодобрения:
  передать его в ходе БЕЗ машины ради БЗ нельзя — сломается автоодобрение
  встроенных Read/Grep. Оставили только `--mcp-config` + хинт, escape hatch
  `VC_KB_TOOL_ALLOWLIST=1`.
- Итоги телеметрии нельзя считать одним запросом с JOIN разделов (суммы
  размножаются), а `prompt_chars` нужно брать по одному значению на `turn_id` —
  промпт хода общий для всех его обращений.
- Кадр `pending` не имеет строки в БД, поэтому его `seq` предсказывается
  (`max(БД, выданное) + 1`): иначе клиентская отсечка по `seq` глотала бы
  «запрашивает…» в чате с историей.

## Куда занесено

- docs/kb/features/kb-usage.md (новая карточка)
- docs/kb/protocol.md (кадр `kb.usage`, REST-снапшоты)
- docs/kb/llm.md (инструменты БЗ в ходе, режимы `kbContextMode`)
- docs/kb/ui.md (панель и кнопка)
- docs/kb/data-auth.md (две таблицы и правила агрегации)
- docs/kb/features/project-knowledge-base.md (ссылка на новую карточку)

## Открытые вопросы / что осталось

- Реально ли Claude в headless одобряет вызовы `mcp__kb__*` без `--allowedTools`
  — проверяется только на живом CLI; при отказе панель покажет 0 запросов
  модели, а авто-инъекция продолжит работать.
