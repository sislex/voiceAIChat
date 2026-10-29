---
title: Архитектура: кто с кем разговаривает
updated: 2026-10-29
checked: 4aa06d23
areas:
  - apps/server/src/playwrightReaderBridge
  - apps/server/src/server.ts
  - apps/server/src/llm
  - apps/server/src/kanban
  - apps/server/src/kanbanBridge
  - package.json
  - apps/server/src/session.ts
  - apps/server/src/turns.ts
---

# Архитектура: кто с кем разговаривает

Module details: `voice:README.md`

Module details: `playwright-reader:README.md`
Module details: `core-ui:README.md`

## Core frontend ownership

### Deployment application selection

Core reads the B01 `VC_APPLICATIONS` selector and `VC_CORE_ID` in `config.ts`.
An absent selector preserves legacy module modes. An explicit list enables only
its application IDs; `id=https://host` enables an external application. Make,
Web Reader, Playwright Reader and Image Studio accept `embedded|remote|off`;
Projects retains `remote|off`. External applications use off local adapters:
Core starts neither their module nor their UI proxy or MCP registration.
Their delegation and one-use ticket endpoints remain available.

`GET /api/system/applications` exposes the deployment manifest to authenticated
clients. Disabled application routes and external application UI prefixes return
`404 { error: 'application_disabled' }`, including `/applications/:id/*` assets.
Core authentication intersects tenant capabilities with enabled applications;
queued turns apply the same intersection when refreshing tenant entitlements.
Voice STT/TTS capabilities belong to Chat. External applications retain tenant
capabilities but do not appear in local runner MCP inventories. Identity login
remains Core infrastructure even in a chat-only deployment.

`sislex/sislexa-core-ui` owns the Core browser client, renderer, UI modules, stories and internal UI gates. Generic UI Kit/Foundation remain in `sislex/sielexa-ui`. Core consumes a versioned static archive with source provenance and per-file hashes; there is no local compatibility workspace. API contracts remain authored in Core and are exported from an exact committed SHA for UI consumption. Changes to an owner package reach consumers only through an explicit pinned archive upgrade and compatibility checks.


## Direct external libraries

UI Kit (`@voicechat/ui-kit`) and UI Foundation
(`@voicechat/ui-foundation`) are maintained in
[`sislex/sielexa-ui`](https://github.com/sislex/sielexa-ui). Core installs their
immutable release archives; `vendor/ui-libraries.json` records owner commit,
SHA-256 and npm SHA-512 integrity. Their old `packages/ui-kit` and
`packages/ui-foundation` workspaces are removed. UI Foundation public runtime ports
still let the host supply one command registry to independent panels.

Core and the transitional Billing consumer import `@sislexa/sdk` directly from
its pinned archive (`package.json` records the current version). `packages/platform-sdk` no longer exists. The application
catalog retains external owner/package metadata for all three libraries, with no
local paths, workspaces or build/test tasks. An explicit Core gate request for an
external library explains which owner repository runs its gate.

Library internal tests and pure primitive stories run only in their owner. Core
checks its own stylesheet and real product compositions against public package
exports. This does not complete the remaining application adapter removals.

## Project identity

The product name is **sislexa**, written in lowercase in current product copy and
knowledge topics. The confirmed public chat domain is `sislexa.by`; its limited
application/model policy is deployment configuration, not a rename or restriction
of the full product. The existing `http://89.125.68.35/` installation remains on
its previous full-feature release and configuration. See
[deployment isolation](deploy.md#public-chat-deployment-isolation) and the
[public launch plan](../plans/public-chat-v1.md).

Existing repository paths, API/package IDs such as `voiceAIChat` and `@voicechat/*`,
and historical quoted output or commit titles retain their original spelling.
Brand copy changes do not rename those identifiers or establish a new deployment.

The proposed move to independently hosted application repositories, shared user
identity, delegated API access, and cross-application usage accounting is tracked
in the [modular platform design](../plans/sislexa-modular-platform.md). That document
distinguishes confirmed requirements from proposed mechanisms; it does not describe
an implemented migration. The first operation/usage contracts are implemented in
shared, while immutable user identity and production usage accounting remain pending. Tool extraction and component authorization are documented below.
It also proposes personal module-level consumption and
active-time analytics, with explicit attribution and overlap rules.

Historical `packages/ui`, `apps/web`, `apps/desktop` and `apps/agent` paths in
layout examples below identify their extracted owners, not local workspaces.
The current Core workspace list is in root `package.json`.

## Границы Reader-модулей

Playwright Reader's API and Chromium worker belong to `sislex/playwrightreader`.
Core imports the published module or connects remotely through
`apps/server/src/playwrightReaderBridge`; data and authorization are supplied
through `PlaywrightReaderCore`. MCP Web Reader использует
`PlaywrightReaderService`; встроенный и отдельный режимы обоих ридеров сочетаются
независимо. Подробнее — [Playwright Reader](features/playwright-reader.md).

Рабочий host загружает панели через `applicationHost.tsx`: собственные IIFE/CSS,
манифест, версия и SRI. Реализации панелей не входят в основной web bundle.

Прокси ядра сохраняет origin под `/web-recorder/`. Релизы `web-reader`, `web-reader-ui`,
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
   ├── RemoteTtsClient → Voice TTS Runner (HTTP resources + WAV)
   └── RemoteLlmClient → independent LLM Runner HTTP /v1/run
      ├──────────────► контейнер-исполнитель LLM (claude/codex CLI, NDJSON)
      │
      ▲  WebSocket, авторизация токеном машины
      │
apps/agent на машине пользователя: exec, файловые операции, PTY, телеметрия
```

## Ключевое разделение ответственности

**The renderer belongs to `sislexa-core-ui`.** Its components use host bridges;
Core defines its REST/WS and renderer-facing contracts in Shared and serves the
verified published assets. Web and Desktop use the owner's HTTP/WebSocket
integration; Electron-specific host behavior belongs to `sislex/desktop`.

**Core is the backend; clients are thin.** Core coordinates speech, storage and
model turns. The independent LLM Runner executes the model CLI through
`RemoteLlmClient` → `POST /v1/run`; Core has no local CLI fallback.
The browser sends microphone PCM and plays WAV audio.

**Ход модели живёт в разговоре, а не в соединении.** `apps/server/src/turns.ts` —
процесс-глобальный `TurnManager`: обновление страницы или обрыв сети не отменяют
генерацию, сервер сам сохраняет готовый ответ в БД, а при (пере)подключении
клиент получает снапшот незакрытых ходов (`claude.active` с накопленным
частичным текстом). Per-connection состояние (микрофон, озвучка, подписки на
tail/PTY) — в `apps/server/src/session.ts`.

**CLI execution is owned by `sislex/llm-runner`.** Core retains HTTP execution
and filesystem-history clients; profile management and process lifecycle run in
the owner service. See [LLM runners](features/llm-runners.md).

**Сборка сервера — `buildServer()` отдельно от `listen()`** (`server.ts` vs
`index.ts`), и все внешние зависимости инъектируются через `BuildOptions`
(`db`, `claude`, `codex`, `sttClient`, `ttsEngine`, `createWsHandlers`,
`sessionSecret`). Отсюда тесты через `fastify.inject()` и ws-клиент с моками
вместо реальных Whisper/CLI.

`buildServer()` creates `RemoteLlmClient` when `VC_LLM_RUNNER_URL` or a
provider-specific endpoint is configured. Otherwise `unconfiguredLlmClient()`
reports unavailable execution. Turn, prompt-suggester and KB-reranker consumers
use the same `LlmClient` interface.

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
The Core UI state-domain map is documented in `core-ui:README.md`.

## Tool repository ownership

Make, Playwright Reader and Web Reader have independent repositories at
`https://github.com/sislex/make`, `https://github.com/sislex/playwrightreader` and
`https://github.com/sislex/webreader`. Each owns its API, UI, contracts and tests;
Web Reader also owns the iframe recorder. Their root distribution packages are
`@sislexa/make`, `@sislexa/playwright-reader` and `@sislexa/web-reader`.

Core consumes immutable owner archives directly; the former application, UI and
contract adapters have been removed. `vendor/owner-artifacts.json` records release
commits and integrity; npm locks archive bytes. Product contract packages retain
public names such as `@voicechat/make-contracts` while their source and tests live
with the owning service. Make lint/search/model helpers and recorder protocol/
scenario helpers are no longer exported from Core Shared.

Core's frontend preparation resolves each owner's public `frontend/manifest.json`,
checks source version/commit and entry/style integrity, and consumes the built
assets unchanged. Core never compiles owner panel or recorder source. The API
serves configured frontend origins or the installed owner artifact. Local recorder
assets use the Web Reader package's public `recorder/*` export; standalone owner
development is configured by endpoint rather than a sibling checkout.

Owner implementation assertions, component stories and accessibility suites run
in the owner repository. Core keeps its own host, resource authorization and
transport integration checks and imports public fixture/client/contract exports.

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
migration in the sislexa plan remains separate.

### Voice and Image Studio ownership

`https://github.com/sislex/voice` owns STT/TTS services and the browser microphone,
PCM, VAD and playback implementation. Core imports the published browser module
and injects host playback telemetry; speech runner and browser-audio compatibility
workspaces are removed. Chat's voice state orchestration and composer remain in the host.
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
Core imports profile/session/account/browser and SQL infrastructure through
public Identity exports. Their compatibility workspaces and pure Core re-export
files are removed. Core resource authorization and database integration remain.

Browser Runner implementation and its internal suites now belong to Playwright
Reader; Core imports the worker client and integration fixtures from that owner. Core's speech session handlers own
chat stream ordering, progress broadcasts and WS translation, not recognition or
synthesis engines. `apps/login-application` is machine enrollment for the companion
agent, not user registration; it remains with machine/client infrastructure.
The LLM Runner implementation and its internal tests belong to `sislex/llm-runner`;
Core uses authenticated HTTP clients and no longer has an embedded CLI fallback.
Core retains chat, machine authorization/registry, SQL repositories and host integration. Kanban owns project workflow, CI/QA, merge, previews and release orchestration; Core connects through `kanbanBridge` with remote/off modes only. The companion runtime is owned by `sislex/agent`, and the Electron host by `sislex/desktop`. Shared UI primitives belong to `sislex/sielexa-ui`.

### Final removal of transitional workspaces

Repository extraction is not complete while Core still needs local compatibility
workspaces to build, run or release another application. The target is direct,
versioned client/contract dependencies and independently built service/UI artifacts.
Keep Core integration checks; run each application's internal checks in its owner
repository. Remove an adapter only after its imports, workspace lists, build/gate
configuration and release inputs have been migrated together.

The following former compatibility directories are removed:

| Owner | Removed Core directories |
| --- | --- |
| Make | `apps/make`, `packages/make-app`, `packages/make-contracts` |
| Image Studio | `apps/image-studio`, `packages/image-studio-app` |
| Playwright Reader | `apps/playwright-reader`, `apps/browser-runner`, `packages/playwright-reader-app`, `packages/playwright-reader-contracts`, `packages/browser-contracts` |
| Web Reader | `apps/web-reader`, `apps/web-recorder`, `packages/web-reader-app`, `packages/web-reader-contracts` |
| Voice | `apps/stt-runner`, `apps/tts-runner`, `packages/voice-browser` |
| Identity | `apps/identity`, `packages/identity-account`, `packages/identity-client`, `packages/identity-contracts`, `packages/identity-login`, `packages/profile-app`, `packages/sessions-app`, `packages/sessions-core`, `packages/storage-sql` |
| Billing | `apps/billing` |
| LLM Runner | `apps/llm-runner`, local CLI/auth/history forwarders |
| Agent | `apps/agent`, `apps/agent-tray`, `apps/login-application`; machine protocol and installer implementations/tests |
| Desktop | `apps/desktop`; Electron host, legacy import and packaging tests |

Identity compatibility exports under `apps/server/src/users`, SQL adapters and
`db/repos/identity.ts` are removed in favor of direct owner imports. Core's own
schema translation and resource/session integration tests remain. UI Kit,
Foundation and SDK local workspaces were removed in Core 0.1.322. The old
`external-workspace.mjs` delegation runner and its tests are no longer needed.

Core now calls configured runner APIs for execution, MCP inventory, authentication
and transcript history. Retouch processing/editor code belongs to Image Studio;
Core owns authorization, attachment access and persistence. All pure account,
session-store and player cases run in their owner repositories. Canonical consumer gates and production acceptance passed in Core 0.1.323/0.1.324;
see deploy.md for the independently pinned owner releases and runtime evidence.
See [the extraction completion plan](../plans/extraction-completion.md).


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

### Canonical product model packages

Core transport DTOs refer to public owner models: Make uses
`@voicechat/make-contracts/make`, browser and preview interactions use
`@voicechat/browser-contracts/*`, and Image Studio uses
`@voicechat/image-studio-contracts/*`. Operation context, usage and monetary
reservation contracts come from `@sislexa/sdk`. Their implementations and unit
suites are removed from Core Shared. Core retains its chat/WS/IPC transport,
resource authorization and host integration tests. Use explicit leaf imports;
re-exporting product runtime modules through the Core Shared barrel can pull
unrelated product initialization into the initial chat bundle.

Consumer validation must include a clean install of the published archives.
Owner npm workspace linking can hide an obsolete distribution peer range; owner
package gates now check that peer ranges accept the matching contract workspace
versions. Archive provenance and internal owner gates do not replace the Core
integration gate.

### Machine and Desktop artifacts

Core consumes `@sislexa/agent` and `@sislexa/agent-contracts` from the Agent owner.
The public download route serves the released bundle byte-for-byte. Desktop owns
Electron main/preload and consumes versioned Agent and Core chat-client artifacts;
Core UI publishes the renderer independently; Core verifies its pinned artifact.
Runtime requirements and source commits are recorded in each archive. Core retains
only compatibility reexports of machine contracts required by already released
consumers, plus server/host integration coverage. See [clients.md](clients.md)
for independent setup and packaging.

## Deployment profiles and shared services

`packages/shared/src/deploymentProfiles.ts` defines `APPLICATION_IDS`,
`parseApplications`, `serializeApplications`, `validateCoreId`, `DeploymentManifest`,
`EnterTicketRedeemRequest/Response`, `TrustedCoreEntry`, `CoreLimits`, `CoreUsage`
and `SharedServiceSession`. `VC_APPLICATIONS` is comma-separated `id` (local) or
`id=https://service` (external). Missing ids are disabled; an unset variable enables
all seven applications. Empty means all disabled. Invalid/duplicate ids and unsafe
external URLs fail configuration. This parser does not impose a UI policy on chat.
`VC_CORE_ID` defaults to the public URL hostname (`localhost` for local development)
and must match `^[a-z0-9][a-z0-9.-]{1,62}$`.

Builds sharing one database MUST share one `VC_CORE_ID`: shared database means shared
data. A different hostname is not a separate data boundary for that database.

`@sislexa/component-runtime` exports `TrustedCoreRegistry`. Load an array of
`{ coreId, url, credentialRef, limits? }` from JSON with `fromFile`, or use `fromEnv`
for `VC_CORE_URL` + `VC_INTERNAL_TOKEN` (optional `VC_CORE_ID`). File references are
server-side secret files; consumers may inject their own secret resolver and fetch
transport. `add`/`remove` update the live registry; `resolve(session)` returns only
public metadata. Resolve on each request, never select a core from untrusted request
URLs. `coreDataPath(root, coreId, ...segments)` rejects traversal and existing
symlinks. Keep the root and its ancestors operator-owned; this helper does not
replace race-free file creation permissions.

`CoreDelegationClient.chatSession` exchanges a delegation at the session's Core: by
default the Core-issued `session.delegation.token` from the redeemed ticket, sent with
the service credential; an explicit Identity grant passed to the constructor keeps the
user-only path without a service bearer. `connect` uses the returned scoped WS handle, sends the
existing `ClientMessage` contract and delivers `ServerMessage` notifications and
`claude.usage` billing events. Core `turns.ts` remains responsible for grant checks,
model execution, Billing admission and settlement. Service credentials never become
user credentials. `redeem()` rejects responses without a valid delegation that
outlives neither the session nor the current time (`isEnterTicketRedeemResponse`).
See data-auth.md «Core-issued ticket delegation».

Registry entries may also carry `serviceCredentialRef` (verifies Core→service calls,
`authenticateCoreRequest`) and `mcpSecretRef` (verifies per-turn MCP tokens,
`verifyCoreMcpToken`; `signCoreMcpToken` signs them in Core, which checks its own tokens with
`verifyCoreMcpTokenWithSecret`). A service serving a Core-run turn calls Core with the
application token plus that turn's MCP token in `x-sislexa-mcp-token`. `fromEnv` reads them from
`VC_CORE_SERVICE_TOKEN` and `VC_CORE_MCP_SECRET`; `resolve()` never returns refs. Core
calls its own internal RPC from a shared service with the application token plus the
ticket delegation; the method table and Core-side variables are in data-auth.md
«Shared-service RPC and MCP».

Use `registry.account(coreId, delta)` before allocating resources; all counters and
returned usage records carry `coreId`. Optional limits are `diskBytes`, `workshops`,
`machines`; a failed multi-counter update changes nothing. Release allocations with
negative deltas. Counters are process-local: owners must initialize them from their
durable resource inventory on startup and serialize allocation through the owning
service instance. `registerCoreServiceErrors` emits HTTP 409
`{ error: 'core_limit_exceeded', limit, used }`. `registerUsageRoute(app, authorize)`
exposes authenticated `GET /internal/v1/cores/:coreId/usage`; the caller supplies the
service's administrator authorization policy. Runtime registry mutations are local;
operators maintain the startup JSON separately.
