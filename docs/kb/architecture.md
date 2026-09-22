---
title: Архитектура: кто с кем разговаривает
updated: 2026-09-22
checked: 0d5b6eea
areas:
  - apps/playwright-reader
  - apps/server/src/playwrightReaderBridge
  - packages/shared/src/playwrightReader.ts
  - apps/server/src/server.ts
  - apps/llm-runner/src/server.ts
  - apps/server/src/session.ts
  - apps/server/src/turns.ts
  - packages/app-shell/src
  - packages/ui/src/index.ts
  - packages/ui/src/createApplication.ts
  - packages/ui/src/adapters
  - packages/ui/src/remote
  - packages/web-reader-app
  - packages/playwright-reader-app
  - apps/web/src/main.tsx
---

# Архитектура: кто с кем разговаривает

## Direct external libraries

UI Kit (`@voicechat/ui-kit` 0.1.2) and UI Foundation
(`@voicechat/ui-foundation` 0.1.4) are maintained in
[`sislex/sielexa-ui`](https://github.com/sislex/sielexa-ui). Core installs their
immutable v1.0.1 release archives; `vendor/ui-libraries.json` records owner commit,
SHA-256 and npm SHA-512 integrity. Their old `packages/ui-kit` and
`packages/ui-foundation` workspaces are removed. UI Foundation public runtime ports
still let the host supply one command registry to independent panels.

Core and the transitional Billing consumer import `@sislexa/sdk` directly from
its pinned 1.1.0 archive. `packages/platform-sdk` no longer exists. The application
catalog retains external owner/package metadata for all three libraries, with no
local paths, workspaces or build/test tasks. An explicit Core gate request for an
external library explains which owner repository runs its gate.

Library internal tests and pure primitive stories run only in their owner. Core
checks its own stylesheet and real product compositions against public package
exports. This does not complete the remaining application adapter removals.

## Project identity

The owner selected **Sislexa** as the project name and confirmed purchasing a
domain with the `sislexa` label. The purchased TLD has not been specified, so
neither `sislexa.com` nor `sislexa.ai` is documented as the confirmed domain.
Use Sislexa when referring to the project. Existing `voiceAIChat`, `ChatAI`, and
`@voicechat/*` technical identifiers remain in the repository; this naming
decision does not establish a new deployment URL or rename those identifiers.

The proposed move to independently hosted application repositories, shared user
identity, delegated API access, and cross-application usage accounting is tracked
in the [modular platform design](../plans/sislexa-modular-platform.md). That document
distinguishes confirmed requirements from proposed mechanisms; it does not describe
an implemented migration. The first operation/usage contracts are implemented in
shared, while immutable user identity and production usage accounting remain pending. Tool extraction and component authorization are documented below.
It also proposes personal module-level consumption and
active-time analytics, with explicit attribution and overlap rules.

## Границы Reader-модулей

Серверная часть Playwright Reader живёт в `apps/playwright-reader`: самостоятельный
Fastify-процесс или модуль ядра. REST `/api/browser/*` и исполнение команд модели
принадлежат приложению, Chromium с профилями — `apps/browser-runner`, данные и
авторизация — ядру через `PlaywrightReaderCore`. MCP Web Reader использует
`PlaywrightReaderService`; встроенный и отдельный режимы обоих ридеров сочетаются
независимо. Подробнее — [Playwright Reader](features/playwright-reader.md).

Reader implementations разделены на workspace-пакеты `packages/web-reader-app` и `packages/playwright-reader-app`; каждый владеет маршрутом, conversation read model, browser surface, store и lifecycle. Их core не импортирует host, другой Reader или chat store: Chat передаётся через `ReaderChatPort`, browser/runtime effects — через `WebReaderHostPort`, `WebRecorderPort`, `PreviewRelayPort`, `PlaywrightReaderHostPort` и `BrowserSessionPort`. Разрешённая product-зависимость Reader → публичный `@voicechat/chat-app` нужна только для `SplitChatWorkspace`; architecture gates запрещают обратную связь и cross-Reader imports.

Рабочий host загружает панели через `applicationHost.tsx`: собственные IIFE/CSS,
манифест, версия и SRI. Реализации панелей не входят в основной web bundle.
`moduleRegistry.ts` сохраняет переходные Reader surfaces; оркестрация разговоров
и общие эффекты ещё находятся в `App.tsx`. Отдельный выпуск панели не означает
полного переноса всех host-адаптеров в новый store.

Web Reader API отделён в `apps/web-reader`, iframe в `apps/web-recorder` входит
в его образ и выпуск. Прокси ядра сохраняет origin под `/web-recorder/`.
`ReaderCore` и HTTP-клиент находятся в `packages/web-reader-contracts`, порты
Playwright — в `packages/playwright-reader-contracts`, клиент Chromium — в
`packages/browser-contracts`. API Reader не имеют общей БД и не импортируют
реализацию браузерного раннера. Релизы `web-reader`, `web-reader-ui`,
`playwright-reader`, `playwright-reader-ui` и `browser-runner` независимы;
диапазоны совместимости проверяются перед deploy.

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
   ├── SttClient ──────► STT Runner (WS /v1/transcribe, whisper-cli, модели)
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
(`db`, `claude`, `codex`, `sttClient`, `ttsEngine`, `createWsHandlers`,
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

## Tool repository ownership

Make, Playwright Reader and Web Reader have independent repositories at
`https://github.com/sislex/make`, `https://github.com/sislex/playwrightreader` and
`https://github.com/sislex/webreader`. Each owns its API, UI, contracts and tests;
Web Reader also owns the iframe recorder. Their root distribution packages are
`@sislexa/make`, `@sislexa/playwright-reader` and `@sislexa/web-reader`.

The corresponding `apps/` and `packages/` workspaces here are compatibility
adapters. They retain public imports and validate the provenance of the installed
upstream workspace through `scripts/external-workspace.mjs`. Do not implement new
features in these adapters. Update an upstream release, replace its `vendor/*.tgz`
archive, update every adapter's `sislexaExternal` provenance and npm lockfile, then
run the application gate. Archives include their source commit in
`release-source.json`; the adapter runner rejects a mismatch. npm integrity pins
the archive bytes. Core checks public exports and its own host/style integration.
Owner implementation assertions, component stories and accessibility suites run
in the owner repository; Core does not discover those installed story files.
Reader integration fixtures resolve the pinned proxy through the explicit
`@fixture/web-reader-proxy` test alias; runtime consumers continue using public
package exports and service contracts.

Common libraries are still owned by this repository. The independent repositories
consume immutable source snapshots with version, base commit, content hash and any
source patch recorded in `dependency-snapshots.json`; they do not maintain forked
common source directories. This transitional distribution works without a private
npm registry. API peers belong to the distribution root; UI requirements belong
to each owned UI workspace, so headless API consumers do not install UI peers.

### Managed component runtime

Core and the independent Make, Playwright Reader and Web Reader services share
`@sislexa/component-runtime` as a Node library; its pure contract remains in shared.
Release-owned dependency ranges and scopes are separate from operator endpoint,
credential-file and grant settings. Static metadata/grant endpoints avoid startup
cycles; readiness and outbound calls enforce compatibility. Provider-local token
registries are separate from application data and outgoing credentials. This is
an infrastructure authorization boundary; the immutable user/delegation/billing
migration in the Sislexa plan remains separate.

### Voice and Image Studio ownership

`https://github.com/sislex/voice` owns STT/TTS services and the browser microphone,
PCM, VAD and playback implementation. `packages/voice-browser` and speech runner
workspaces here are adapters; host audio files preserve imports and inject playback
telemetry. Chat's voice state orchestration and composer remain in the host.
`https://github.com/sislex/image-studio` owns the Image Studio API and UI panel.
Its Core bridge retains identity, conversation and model-execution ownership.
Both repositories install independently using shared snapshots and publish source
archives with full SHA provenance. Speech/image pure wire contracts remain in shared.
See [the extraction plan](../plans/voice-image-extraction.md) for boundaries.

### Identity ownership audit

`https://github.com/sislex/identity` now owns login/registration/recovery/2FA,
account/profile/session UI, browser session transport, auth enforcement, credential
storage, personal tenant provisioning, tariff catalog/assignments and effective
product capabilities. Core supplies resource permissions, project invitations,
account report aggregation, host cache/performance hooks and desktop legacy import.
`packages/profile-app`, `sessions-app` and `sessions-core` are compatibility adapters.
`packages/storage-sql` consumes the SQL infrastructure from the same upstream source.

Previously extracted Make, Web Reader, Playwright Reader, Voice and Image Studio
workspace source remains import-only adapters. Core's speech session handlers own
chat stream ordering, progress broadcasts and WS translation, not recognition or
synthesis engines. `apps/login-application` is machine enrollment for the companion
agent, not user registration; it remains with machine/client infrastructure.
`apps/llm-runner` still contains implementation in Core, and Core imports its CLI
exports for embedded execution. Deploying an independently released runner does
not remove these source dependencies. Chat/agents, projects, operations and release orchestration remain Core
responsibilities. Shared UI primitives now belong to `sislex/sielexa-ui`.

### Final removal of transitional workspaces

Repository extraction is not complete while Core still needs local compatibility
workspaces to build, run or release another application. The target is direct,
versioned client/contract dependencies and independently built service/UI artifacts.
Keep Core integration checks; run each application's internal checks in its owner
repository. Remove an adapter only after its imports, workspace lists, build/gate
configuration and release inputs have been migrated together.

The current `sislexaExternal` manifests identify these removal groups:

| Owner | Transitional Core directories |
| --- | --- |
| Make | `apps/make`, `packages/make-app`, `packages/make-contracts` |
| Image Studio | `apps/image-studio`, `packages/image-studio-app` |
| Playwright Reader | `apps/playwright-reader`, `packages/playwright-reader-app`, `packages/playwright-reader-contracts` |
| Web Reader | `apps/web-reader`, `apps/web-recorder`, `packages/web-reader-app`, `packages/web-reader-contracts` |
| Voice | `apps/stt-runner`, `apps/tts-runner`, `packages/voice-browser` |
| Identity | `apps/identity`, `packages/identity-account`, `packages/identity-client`, `packages/identity-contracts`, `packages/identity-login`, `packages/profile-app`, `packages/sessions-app`, `packages/sessions-core`, `packages/storage-sql` |
| Billing | `apps/billing` |

Identity compatibility exports under `apps/server/src/users`, `apps/server/src/db/sql`
and `apps/server/src/db/repos/identity.ts` can also go once consumers import their
owner directly. Preserve Core resource authorization and move its integration
tests to the appropriate Core test locations. Removing `apps/llm-runner` additionally
requires replacing embedded CLI imports with the independent runner interface.

`packages/ui-kit`, `packages/ui-foundation` and `packages/platform-sdk` have
been removed; their consumers install owner release archives directly. Split
public library contracts from Core-private contracts before considering removal of `packages/shared` or
`packages/component-runtime`. The current `vendor` archives and
`scripts/external-workspace.mjs` remain required until their distribution and gate
roles have replacements; deleting directories alone does not establish independence.
The owner requested completion of these transfers and removal of application-owned
tests from Core; track the remaining work and acceptance in
[the extraction completion plan](../plans/extraction-completion.md).


## Authorized delivery roadmap and next repositories

The owner authorized all fifteen follow-on deliverables, autonomous technical
choices, PR creation/merge, staged releases and production verification. Track
acceptance evidence in `docs/plans/sislexa-delivery-roadmap.md`; authorization is
not evidence that those features are already implemented.

The supplied `sislex/billing`, `sislex/analytics`, `sislex/sdk` and
`sislex/sielexa-ui` repositories were accessible and empty on 2026-09-20. Preserve
the exact `sielexa-ui` spelling. Billing will own transactional financial usage;
Analytics will own reporting/activity projections; SDK and UI are versioned
libraries. Existing Identity retains user/tenant identity and entitlement policy.
