---
title: Архитектура: кто с кем разговаривает
updated: 2026-08-18
checked: 6fceafd
areas:
  - apps/server/src/server.ts
  - apps/llm-runner/src/server.ts
  - apps/server/src/session.ts
  - apps/server/src/turns.ts
  - packages/app-shell/src
  - packages/ui/src/index.ts
  - packages/ui/src/createApplication.ts
  - packages/ui/src/adapters
  - packages/ui/src/remote
  - apps/web/src/main.tsx
---

# Архитектура: кто с кем разговаривает

## Границы Reader-модулей

Reader implementations разделены на workspace-пакеты `packages/web-reader-app` и `packages/playwright-reader-app`. Их core не импортирует host, другой Reader или chat store: Chat передаётся через `ReaderChatPort`, browser/runtime effects — через `WebReaderHostPort`, `WebRecorderPort`, `PreviewRelayPort`, `PlaywrightReaderHostPort` и `BrowserSessionPort`. Host registry содержит динамические imports обоих продуктов; legacy `App` всё ещё является действующим bootstrap и потому временно содержит совместимый старый Reader path.

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
   └── LLM client       Claude/Codex: локальный spawn (код — apps/llm-runner)
      │                  ИЛИ HTTP → /v1/run
      ├──────────────► контейнер-исполнитель LLM (claude/codex CLI, NDJSON)
      │
      ▲  WebSocket, авторизация токеном машины
      │
apps/agent на машине пользователя: exec, файловые операции, PTY, телеметрия
```

## Ключевое разделение ответственности

**Весь UI — в `packages/ui`, он не знает транспорта.** Компоненты и стор общаются
только через мосты `window.*`, формы которых описаны в `packages/shared/src/ipc.ts`.
Поэтому одна и та же фича автоматически работает и в web (REST+WS), и в desktop
(Electron IPC). `apps/web` — это ~3 файла: конфиг адреса сервера, установка мостов,
монтирование `<App/>`.

**Сервер — полноценный бэкенд, клиенты тонкие.** Распознавание, озвучка,
хранение и orchestration хода — на сервере. Сам CLI модели теперь может жить
либо рядом с ним (`ClaudeCli`/`CodexCli` через `spawn`), либо за HTTP как
удалённый исполнитель (`RemoteLlmClient` → `POST /v1/run`). Браузер отдаёт
только PCM с микрофона и играет WAV.

**Ход модели живёт в разговоре, а не в соединении.** `apps/server/src/turns.ts` —
процесс-глобальный `TurnManager`: обновление страницы или обрыв сети не отменяют
генерацию, сервер сам сохраняет готовый ответ в БД, а при (пере)подключении
клиент получает снапшот незакрытых ходов (`claude.active` с накопленным
частичным текстом). Per-connection состояние (микрофон, озвучка, подписки на
tail/PTY) — в `apps/server/src/session.ts`.

**Спавн CLI выделен в отдельный воркспейс.** Код запуска `claude`/`codex`
(`claudeCli.ts`, `codexCli.ts`, `childKill.ts`, профили CLI) живёт в
`apps/llm-runner` — исполнителе с собственным HTTP (`/v1/run`). Сервер может
либо импортировать эти классы напрямую (`@voicechat/llm-runner/cli`) и спавнить
CLI локально, либо переключиться на `RemoteLlmClient` и ходить в удалённый
исполнитель по HTTP; детали — [features/llm-runners.md](features/llm-runners.md).

**Сборка сервера — `buildServer()` отдельно от `listen()`** (`server.ts` vs
`index.ts`), и все внешние зависимости инъектируются через `BuildOptions`
(`db`, `claude`, `codex`, `sttEngine`, `ttsEngine`, `createWsHandlers`,
`sessionSecret`). Отсюда тесты через `fastify.inject()` и ws-клиент с моками
вместо реальных Whisper/CLI.

`buildServer()` выбирает транспорт LLM по конфигу: есть `VC_LLM_RUNNER_URL`
(или адреса по провайдерам) — собирается `RemoteLlmClient`; нет — остаётся
локальный `spawn`. При этом `turns.ts`, prompt-suggester, KB-reranker и CI-раннер
работают с одним интерфейсом `LlmClient` и не знают, где реально запущен CLI.

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
`speaking`). Голосовой стор (`packages/ui/src/store/domains/voiceStore.ts`) —
обычное замыкание с `getState/subscribe/actions/dispose`, не привязанное к React:
тестируется без DOM, React подключается через `store/react.tsx`. После CHAT-236 он
отвечает только за аудио: готовую транскрипцию он публикует событием, а разговор
создаёт и реплику сохраняет `chatStore` — их сводит `runtime/appRuntime.ts`.
Карта доменов состояния — [ui.md](ui.md#слои).

Озвучка идёт по мере готовности предложений: `sentences.ts` (shared + ui) режет
поток токенов на произносимые фразы, `lib/ttsPlayer.ts` играет их очередью.
VAD (`lib/vad.ts`) даёт hands-free и barge-in.

## Платформенно-независимый frontend runtime

`createAppRuntime(ports, modules)` из `packages/app-shell/src/runtime.ts` создаёт независимые shell/session/settings/voice stores и `ModuleRegistry`; общего singleton и публичного универсального `setState` у runtime нет. Платформенные эффекты приходят через `ApplicationPorts`: session/settings/voice clients, `AppShellHost`, optional reconnect и cleanup. `packages/ui/src/createApplication.ts` предоставляет тонкую обёртку `createApplication({ bridges, modules? })`, а `createBrowserAdapters` собирает browser location/logging host из переданных clients, не создавая сеть при импорте.

При активации registry сначала применяет `visible` и role gates к parser-кандидатам, и только затем runtime выполняет отдельные стадии `module.load()`, optional `createStore()` и `bootstrap()`. Экземпляр модуля кэшируется по id; realtime-события направляются подписчикам owner id. Logout/dispose собирают dispose загруженных модулей, зарегистрированные cleanup, reconnect unsubscribe и остановку voice, исполняют их через `Promise.allSettled`, поэтому отказ одного ресурса не отменяет остальные попытки; повторные logout/dispose защищены общими promises. После logout session очищается и host делает replace-переход на `#/`.

Это новый composition path, но ещё не единственный frontend runtime: `packages/ui/src/index.ts` продолжает экспортировать legacy `App.tsx` с прежним host runtime и продуктовыми компонентами. Web/desktop bootstrap этим изменением на `createApplication` не переведён.

## Единый контейнер popup

Все модальные поверхности UI используют `PopupFrame`: он владеет overlay, `role=dialog`, кликом по фону и обработкой Escape. `ToolFrame` остаётся надстройкой для тулов и полноэкранного режима, но его modal-вариант также построен на `PopupFrame`.
