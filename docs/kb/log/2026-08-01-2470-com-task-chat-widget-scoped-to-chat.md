---
title: Виджет задачи виден только в своём чате
date: 2026-08-01
machine: 2470-com
author: alexeyrozhnov
---

# Виджет задачи виден только в своём чате

## Что сделано

- В `TaskChatContext` (`packages/shared/src/projects.ts`) добавлено поле
  `conversationId`; сервер кладёт туда id запрошенного чата
  (`db.getTaskChatContext`, `apps/server/src/db/database.ts`).
- `App.tsx` рисует `TaskChatHeader` только при
  `state.taskChatContext.conversationId === state.activeId`.
- В `voiceStore.ts` появились хелперы сброса per-chat состояния —
  `chatScopedReset()` (лента + контекст задачи) и `chatSwitchReset()` (плюс живое
  состояние хода). Ими пользуются `selectConversation`, `newConversation`,
  автосоздание чата в `ensureConversation`, `resumeCcSession`, `resumeCxSession`.
- `fakeApi.ts`: `conversations:taskContext` из заглушки `null` превращён в честную
  сборку контекста по `conv.taskId`.
- Тесты: стор (сброс на трёх переходах + опоздавший ответ), DOM (после «+ Новый»
  виджета нет, лента есть; чужой `conversationId` не рисуется), сервер
  (`taskChatContext.test.ts` ждёт `conversationId`).

## Что выяснили (факты, которых не было в KB)

- Залипание виджета было двойным: контекст чистила только `loadTaskChatContext`,
  которую звал лишь `selectConversation`, а у самого контекста не было признака
  владельца — поэтому любая новая точка смены `activeId` возвращала баг. Защита
  теперь с двух сторон: сверка по `conversationId` в рендере (делает залипание
  невозможным по построению) и общий хелпер сброса в сторе.
- DOM-тест на такое поведение был невозможен, пока фейковый мост отдавал
  `taskContext: null`: инварианты фейка должны совпадать с серверными, иначе баг
  в тесте не воспроизводится.

## Куда занесено

- `docs/kb/ui.md` — «Компоненты и поверхности» (виджет как свойство открытого чата,
  хелперы сброса) и «Тестирование UI» (фейковый `taskContext`).
- `docs/kb/projects.md` — контекст помечен своим `conversationId`.
- `docs/kb/protocol.md` — `conversations:taskContext` отдаёт `conversationId`.
- Статья «База знаний в CI-ране…» не затронута по смыслу — обновлений не требует.

## Открытые вопросы / что осталось

- Хелперы сброса пока не покрывают `draft`/`attachments`/`promptHelper` (их чистит
  только `newConversation`) — если появится ещё одна точка смены чата, решить,
  переносить ли их внутрь `chatSwitchReset()`.
