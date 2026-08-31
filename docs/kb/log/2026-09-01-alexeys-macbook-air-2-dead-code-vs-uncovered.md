---
title: dead-code-vs-uncovered
date: 2026-09-01
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# dead-code-vs-uncovered

Цикл 9 из 10. Собирался дописать тесты по списку невызванных функций из циклов
7–8 — и вовремя заметил, что список смешанный: часть методов не вызвана тестами,
а часть не вызвана **вообще ничем**. Тест на второе хуже, чем его отсутствие.

## Что сделано

- **Удалено пять мёртвых функций** `db/database.ts` (32 строки):
  `taskChatLlmDefaults`, `recommendedProjectAssignments`, `setCiWorkspaceSize`,
  `releaseDoneWorkspaces`, `isCommitStepLike`.
- **15 тестов на живые непокрытые методы**: охраны `softDeleteProjectRelease`
  (шесть причин отказа), `saveQaAdditionalIssues` (правки только у живой
  сессии), `ciCommandUsage` (дедупликация владельцев).
- Проверено мутациями: все четыре мутации существующий набор не ловил.

## Что выяснили (факты, которых не было в KB)

- **Невызванная функция бывает двух видов, и их надо разделять.** Из 25
  невызванных функций `database.ts` пять оказались мёртвыми — ни одной ссылки во
  всём репозитории. У `isCommitStepLike` комментарий описывал намерение
  («актуализация БЗ встаёт перед шагом коммита»), которого в коде уже нет:
  соседние предикаты `isMergeToBaseStepLike` и `isProductionDeployStepLike`
  используются, а этот — нет.
- **В `apps/server` выключены `noUnusedLocals` и `noUnusedParameters`** (в
  `packages/ui` включены) — поэтому мёртвый код и накопился. Их включение даёт
  **45 ошибок** по пакету, среди них ещё `runKbUpdateStep` в `ci/runManager.ts`
  и `resolveCiStageModel` в `ci/modelHooks.ts`.
- **Удаление релиза мягкое и асимметричное**: `listProjectReleases` фильтрует
  `deleted_at IS NULL`, а `getProjectRelease` — нет, поэтому по прямой ссылке
  удалённый релиз остаётся доступен (история деплоя не теряется). Повторное
  удаление проходит молча: охрана `deleted_at` не смотрит.
- `generated/kb/documents.json` даёт ложные совпадения при поиске ссылок на
  функцию: в нём встроены тексты статей БЗ, где имена упоминаются в прозе.
  При подсчёте ссылок его надо исключать наравне с `node_modules`.

## Куда занесено

- docs/kb/testing-operations.md — раздел «Невызванная функция — это либо
  непокрытая, либо мёртвая. Разделять обязательно», с командой подсчёта ссылок
  и находкой про выключенные флаги в `apps/server`

## Открытые вопросы / что осталось

- **Включить `noUnusedLocals`/`noUnusedParameters` в `apps/server`** — 45 ошибок,
  отдельная задача. Пока мёртвый код там ищется только руками.
- Осталось ~15 живых непокрытых методов `database.ts`: `answerQaStageRun`,
  `appendQaPreparationLog`, `linkQaFixRun`, `addPreviewAudit`, `appendMergeLog`,
  `getTaskRepositoryById`, `deleteModelPrice`, `deleteKbDocument`.
- `ci/runManager.ts` (209 непокрытых ветвей) и `server.ts` (183).
