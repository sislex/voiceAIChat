---
title: qa-run-lifecycle-coverage
date: 2026-09-01
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# qa-run-lifecycle-coverage

Цикл 8 из 10. Продолжение цикла 7: добраны невызванные методы `db/database.ts`,
на этот раз связная группа — жизненный цикл ранов Component QA и Integration QA.
Осталось 35 из исходных 45.

## Что сделано

- **19 тестов** на `componentQaExecutionContext`, `appendComponentQaLog`,
  `finishComponentQaRun`, `cancelComponentQaRun`, `linkComponentQaFixRun`,
  `integrationTestExecutionContext`, `appendIntegrationTestLog`,
  `finishIntegrationTestRun`, `cancelIntegrationTestRun`,
  `linkIntegrationTestFixRun`.
- Проверено мутациями: **все пять мутаций существующий набор не ловил**.

## Что выяснили (факты, которых не было в KB)

- **Переходы статусов ранов охраняются в SQL и потому молчат.** Охрана вида
  `... WHERE id=? AND status='running'` или `... AND linked_fix_run_id IS NULL`
  на ране в неподходящем статусе просто ничего не меняет — ни ошибки, ни
  исключения. Регрессия проявляется поведением: «лог иногда не пишется»,
  «отменённый ран копит вывод», «ссылка на исправление перескочила». Значит тест
  обязан проверять и вызов из неподходящего статуса, а не только успешный путь.
- **`cancelComponentQaRun` для чужого падает как «ран не найден», а не «нет
  прав»** — `getComponentQaRun` сначала не находит ран в чужом проекте. Это
  правильнее: «нет прав» подтвердило бы существование рана. Я сперва написал
  тест на «нет прав» и был неправ.
- **`startIntegrationTestRun` с `uiImpact: 'none'` сразу отдаёт `skipped`**:
  без обязательных автоматизируемых тест-кейсов в снимке готовности ран не
  создаётся. Для фикстуры нужен `existing_components`.
- Фикстуры QA вставляют строки с жёсткими id (`prep-component`, `ws-component`,
  `dev-component`); при двух вызовах в одном тесте — `UNIQUE constraint failed`.
  Нужен суффикс на вызов.

## Куда занесено

- docs/kb/testing-operations.md — раздел «Переходы статусов ранов охраняются в
  SQL и потому молчат», включая деталь про формулировку отказа чужому

## Открытые вопросы / что осталось

- Осталось ~25 невызванных функций `database.ts`: QA-этапы (`answerQaStageRun`,
  `appendQaPreparationLog`, `saveQaAdditionalIssues`, `linkQaFixRun`), релизы
  (`softDeleteProjectRelease`, `releaseDoneWorkspaces`), `deleteKbDocument`,
  `addPreviewAudit`, `appendMergeLog`, `recommendedProjectAssignments`.
- `ci/runManager.ts` (209 непокрытых ветвей) и `server.ts` (183).
