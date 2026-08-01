---
title: Архитектура: кто с кем разговаривает
updated: 2026-07-27
checked: 49465ae
areas:
  - apps/server/src/server.ts
  - apps/llm-runner/src/server.ts
  - apps/server/src/session.ts
  - apps/server/src/turns.ts
  - packages/ui/src/index.ts
  - packages/ui/src/remote
  - apps/web/src/main.tsx
---

# Архитектура: кто с кем разговаривает

```
браузер / Electron-renderer
      │  window.api / window.claude / window.stt / ...   (формы — @shared/ipc)
      ├── web:      мосты поверх REST + WebSocket  (packages/ui/src/remote)
      └── desktop:  мосты поверх Electron IPC      (apps/desktop/src/preload)
      ▼
apps/server (Fastify)
   ├── REST /api/*      разговоры, настройки, модели, голоса, машины, админка
   ├── WS   /ws         стриминг: аудио→STT, токены LLM, WAV TTS, PTY-релей
   ├── WS   /agent      подключения компаньон-агентов (машин)
   ├── /mcp/remote-bash MCP-инструмент bash для спавнутого claude
   ├── /v1/messages     входящий Anthropic-совместимый gateway
   ├── SQLite           better-sqlite3, WAL
   ├── whisper-cli      распознавание (spawn)
   ├── piper / say      озвучка (spawn)
   └── claude / codex   LLM (spawn CLI, stream-json; код — apps/llm-runner)
      ▲
      │  WebSocket, авторизация токеном машины
apps/agent на машине пользователя: exec, файловые операции, PTY, телеметрия
```

## Ключевое разделение ответственности

**Весь UI — в `packages/ui`, он не знает транспорта.** Компоненты и стор общаются
только через мосты `window.*`, формы которых описаны в `packages/shared/src/ipc.ts`.
Поэтому одна и та же фича автоматически работает и в web (REST+WS), и в desktop
(Electron IPC). `apps/web` — это ~3 файла: конфиг адреса сервера, установка мостов,
монтирование `<App/>`.

**Сервер — полноценный бэкенд, клиенты тонкие.** Распознавание, озвучка, LLM,
хранение — на сервере. Браузер отдаёт только PCM с микрофона и играет WAV.

**Ход модели живёт в разговоре, а не в соединении.** `apps/server/src/turns.ts` —
процесс-глобальный `TurnManager`: обновление страницы или обрыв сети не отменяют
генерацию, сервер сам сохраняет готовый ответ в БД, а при (пере)подключении
клиент получает снапшот незакрытых ходов (`claude.active` с накопленным
частичным текстом). Per-connection состояние (микрофон, озвучка, подписки на
tail/PTY) — в `apps/server/src/session.ts`.

**Спавн CLI выделен в отдельный воркспейс.** Код запуска `claude`/`codex`
(`claudeCli.ts`, `codexCli.ts`, `childKill.ts`, профили CLI) живёт в
`apps/llm-runner` — исполнителе с собственным HTTP (`/v1/run`). Сервер пока
импортирует эти классы напрямую (`@voicechat/llm-runner/cli`) и спавнит CLI в
своём процессе: переход на HTTP — следующий срез, см.
[features/llm-runners.md](features/llm-runners.md).

**Сборка сервера — `buildServer()` отдельно от `listen()`** (`server.ts` vs
`index.ts`), и все внешние зависимости инъектируются через `BuildOptions`
(`db`, `claude`, `codex`, `sttEngine`, `ttsEngine`, `createWsHandlers`,
`sessionSecret`). Отсюда тесты через `fastify.inject()` и ws-клиент с моками
вместо реальных Whisper/CLI.

## Один backend, два клиентских хоста

`apps/desktop` теперь тонкая Electron-оболочка: browser и Electron используют
одинаковые REST/WS-мосты из `@voicechat/ui`, а единственный backend находится в
`apps/server`. Main-процесс desktop управляет окном, URL сервера и режимом
компаньон-агента.

Старая `voicechat.db` используется только как источник одноразовой миграции. После
успешного логина desktop отправляет разговоры через авторизованный идемпотентный
`POST /api/migrations/desktop` и помечает URL сервера в `remote.json`. Файл БД
автоматически не удаляется; локальных STT/TTS/LLM/IPC-сервисов в desktop больше нет.

## Голосовой цикл

`idle → listening → transcribing → thinking → speaking → idle`, переходы — только
через чистый редьюсер `packages/shared/src/stateMachine.ts` (включая barge-in из
`speaking`). Стор (`packages/ui/src/store/voiceStore.ts`) — обычное замыкание с
`getState/subscribe/actions`, не привязанное к React: тестируется без DOM,
React подключается через `useVoiceStore.ts`.

Озвучка идёт по мере готовности предложений: `sentences.ts` (shared + ui) режет
поток токенов на произносимые фразы, `lib/ttsPlayer.ts` играет их очередью.
VAD (`lib/vad.ts`) даёт hands-free и barge-in.

## Единый контейнер popup

Все модальные поверхности UI используют `PopupFrame`: он владеет overlay, `role=dialog`, кликом по фону и обработкой Escape. `ToolFrame` остаётся надстройкой для тулов и полноэкранного режима, но его modal-вариант также построен на `PopupFrame`.
