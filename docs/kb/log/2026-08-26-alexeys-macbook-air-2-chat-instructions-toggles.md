---
title: Инструкции чата с чекбоксами в настройках
date: 2026-08-26
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Инструкции чата с чекбоксами в настройках

## Что сделано

- `Settings.chatInstructions` (shared/types) + каталог и сборка подсказок `packages/shared/src/chatInstructions.ts`;
  `TOOL_HINT` стал `toolHint(kinds)` — терминал и проводник выключаются раздельно.
- `turns.ts`: цепочка `append*Hint` заменена на `appendChatInstructionHints(basePrompt, settings.chatInstructions)`.
- `stripDisabledInstructionBlocks` (shared) в `turns.ts` `onDone`: блоки выключенных инструкций вырезаются из ответа.
- Инструкции стали списком `ChatInstruction[]` с правкой текста/дублированием/добавлением/удалением (`ChatInstructionsSettings`); в инспекторе контекста — группа «Инструкции чата» с per-чат тумблерами (`instruction-<id>`).
- `SettingsModal` → раздел «Инструкции»; `database.getSettings` мержит поле с дефолтами.
- Заодно ранее в сессии: flex-колонка чата в Reader/Консоли, скрытый STT-баннер при выключенном голосе,
  лоадер вместо мигающей формы логина (`sessionStore.checking` с старта).

## Что выяснили (факты, которых не было в KB)

- Подсказки дописываются только к непустому промпту: на первом ходе без реплики в БД `basePrompt` пуст,
  поэтому тесты `turns` должны сначала `db.addMessage`.
- Релизы идут только через Release Center (`release/0.1.N`, prod `89.125.68.35`); git-теги `v0.1.x` в
  процессе не участвуют. После деплоя открытая вкладка держит старую сборку и «зависшую» ленту health-check
  до перезагрузки страницы.

## Куда занесено

- docs/kb/llm.md — «Договорённости в тексте ответа»; docs/kb/shared.md — сборка промпта; docs/kb/ui.md — раздел настроек.

## Открытые вопросы / что осталось

- Вкладка после деплоя не переподключает WS-ленту релиза и не подхватывает новую сборку сама.
