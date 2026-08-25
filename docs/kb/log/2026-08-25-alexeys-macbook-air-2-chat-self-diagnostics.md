---
title: chat-self-diagnostics
date: 2026-08-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# chat-self-diagnostics

## Что сделано

- Самодиагностика обычного чата по образцу Web Reader: модуль
  `packages/ui/src/chatDiagnostics.ts` (`isChatDiagnosticsCommand`,
  `runChatDiagnostics`, 11 шагов, слои transport/backend/model/persistence/store).
  Запуск командой в композере `самодиагностика чата` / `/chat-diagnostics`
  (перехват в App.tsx onSubmitText). Публикация — `publishDiagnosticMessage`
  (без LLM), останов на первом провале с указанием слоя.
- Пробы замыкают мосты window.*: app:ping, realtime.connected(), session:me,
  system:capabilities, auth:status[engine], mcp:list, prompt:suggest (реальный
  лёгкий ход Claude/haiku), conversations:create/get/delete + messages:add
  (эфемерная беседа мимо стора, finally-подчистка), снимок стора.
- Для проверки WS добавлены `WsClient.isConnected()` и
  `RendererRealtimeBridge.connected()`.
- Тесты: chatDiagnostics.test.ts (6), +assert connected() в remote.test.ts.
  Гейты: shared 553, ui 1776, typecheck всего. Живой прогон: transport-шаги
  прошли, auth-cli честно упал на backend (dev-стенд без claude login).

## Что выяснили (факты, которых не было в KB)

- Роль пользовательского сообщения — `u${number}` (не 'user'): для маркера
  персистентности использую 'u0'.
- prompt:suggest всегда Claude/haiku — дешёвый способ проверить сквозной LLM-путь
  без записи в беседу; движок разговора проверяется отдельно через auth:status.

## Куда занесено

- docs/kb/ui.md — абзац про самодиагностику чата рядом с Web Reader.
- docs/kb/testing-operations.md — раздел «Диагностика по слоям»: автоматизация из UI.

## Открытые вопросы / что осталось

- Голос STT/TTS в скоуп не входил (по решению) — микрофон/синтез не проверяются.
- Кнопки запуска в настройках нет — только команда (по решению).
