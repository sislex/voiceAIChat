---
title: database-uncalled-methods
date: 2026-09-01
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# database-uncalled-methods

Цикл 7 из 10. Взялся за `db/database.ts` — 787 непокрытых ветвей, самая большая
одиночная цель. Главное — нашёлся способ искать в таком файле цель осмысленно.

## Что сделано

- **Покрыты методы, которые не вызывал ни один тест**: группа отложенной уборки
  managed-разговоров (`listGeneratedCleanupTargets`, `deferGeneratedCleanup`,
  `completeGeneratedCleanup`, `getGeneratedCleanupRetry`), журнал тревог машины
  (`logMachineEvent`, `listMachineEvents`), привязка workspace разговора
  (`saveConversationWorkspace`, `clearConversationWorkspace`), `setUserRole`,
  `pruneEmailVerifications`. 22 теста.
- Проверено мутациями: **все пять мутаций в этих методах существующий набор не
  ловил**, новые тесты ловят все пять.

## Что выяснили (факты, которых не было в KB)

- **В большом файле цель ищется по счётчику вызовов функций, а не по проценту.**
  787 непокрытых ветвей размазаны по 609 функциям, и процент не подсказывает
  ничего. Полезен другой срез того же json-отчёта: `fnMap` + `f`, где `f[id] === 0`.
  Нашлось **45 невызванных функций из 609**.
- **Контраст с циклом 6 подтверждает, что срез правильный.** На `users/auth.ts`
  (уже покрыт route-тестами) из пяти мутаций три ловились и без нового файла.
  Здесь — ни одной из пяти: методы буквально никем не вызывались.
- `saveChatStorageBinding(userId, binding)` требует настоящих машины и хранилища
  (`createAgent` + `saveMachineStorage`), а `conversation_workspaces` держится
  внешними ключами на разговор, проект, машину и хранилище — все четыре надо
  заводить по-настоящему, иначе SQLite отвергает вставку.
- `saveConversationWorkspace` возвращает **`WorkspaceView`**, а не сохранённую
  привязку: наружу идут `mode`, `baseSha`, `branch`, `path`, `readOnly`, `state`,
  `diagnostic`; `machineId` и `storageId` остаются внутри БД. Первую версию теста
  я написал по догадке о форме — не сошлось.

## Куда занесено

- docs/kb/testing-operations.md — раздел «Где в большом файле искать непокрытое:
  счётчик вызовов функций», с командой и результатом

## Открытые вопросы / что осталось

- Осталось ещё ~35 невызванных функций `database.ts`: Component QA
  (`appendComponentQaLog`, `finishComponentQaRun`, `cancelComponentQaRun`…),
  Integration QA (`appendIntegrationTestLog`, `completeIntegrationTestRun`…),
  QA-этапы (`answerQaStageRun`, `appendQaPreparationLog`, `linkQaFixRun`),
  релизы (`softDeleteProjectRelease`, `releaseDoneWorkspaces`).
- `ci/runManager.ts` (209 непокрытых ветвей) и `server.ts` (183) — следующие
  по величине после `database.ts`.
