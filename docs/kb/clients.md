---
title: Клиенты и упаковка: web, desktop и agent-tray
updated: 2026-10-31
checked: 242d084b
areas:
  - apps/server/src/config.ts
  - apps/server/src/server.ts
  - scripts/core-ui-artifact.mjs
  - scripts/dev-ui-proxy.mjs
  - apps/server/src/routes/androidApp.ts
  - packages/shared/src/androidRelease.ts
---

# Клиенты и упаковка: web, desktop и agent-tray

Module details: `web-reader:README.md`
Module details: `core-ui:README.md`
Module details: `agent:README.md`

## Android APK distribution

Core pins the owner's `android-release.json` in `vendor/android/`. The
`AndroidReleaseManifest` contract and REST paths are in `packages/shared`.
The 0.1.1 pin adds versionName 0.1.1 and versionCode 2, verified against
`apps/android/app/build.gradle.kts` at owner commit
`7d90ff455a4a495185bbb76d4bfc6f1b27c0d005`; the owner's release script does not
yet emit these fields.

`GET /api/app/android` publicly returns schemaVersion 1 and the android fields,
with url replaced by `/api/app/android/apk`. No upstream URL or credentials are
returned. The APK endpoint verifies size and SHA-256 of the exact response bytes
before sending them, including before 304. Both endpoints support ETag and
`Cache-Control: no-cache`; missing pins return 404, invalid pins or unavailable/
corrupt binaries return 503. APK responses use the Android package MIME type and
an attachment filename. Public handlers complete during onRequest, before the
Identity/forwarded-auth preHandler; the Machines proxy does this only for GET/HEAD
on these two exact paths.

`VC_ANDROID_MANIFEST` overrides the pin location; normal runtime defaults to the
repository pin. A matching APK can be placed beside the manifest (ignored by Git).
Otherwise Core fetches the pinned URL, using server-only `VC_GITHUB_TOKEN` with
GitHub's release-asset API for private releases, and retains downloaded bytes in
memory. Compose forwards this token to both Core and the standalone Machines service. Download failure remains a 503, never a redirect to private GitHub.
Tests inject the pin path and fetch dependency.

## Core UI distribution

Web and Desktop renderer sources belong to `sislex/sislexa-core-ui`. Core serves the pinned `@sislexa/core-ui/web` assets and verifies the owner manifest before building its image. `npm run dev:web` starts Core with that static directory and proxies the familiar port 5273 to Core; UI editing and HMR use `npm run dev` in the UI owner repository. Configure `VITE_SERVER_URL` or `VC_API_PORT` there. Existing Desktop releases remain pinned to their released renderer until an explicit Desktop dependency upgrade.

The historical public-chat candidate pinned Core UI 1.5.28 from
`f86cdd2db9e4e002f1fd14da36bed6fa1119eb2c`. Its daily quota panel shows settled
spend, remaining allowance and the Europe/Minsk reset. Voice onboarding uses
optional `CapabilityStatus.configured`, introduced in Shared 0.1.42 and retained
in the installed Shared 0.1.43: explicit absence hides
both automatic and manual launchers without changing saved onboarding progress.
Legacy servers fall back to availability only when configuration is unspecified;
unknown or failed capability reads do not block chat readiness. A configured but
unhealthy voice module remains discoverable for diagnosis. The owner also fixes
the mobile model trigger and popup geometry. Core keeps artifact and browser
integration checks; the implementation and responsive regressions live in the
Core UI owner repository. Candidate stand evidence and remaining public
commissioning work are recorded in `docs/plans/public-chat-v1.md`.

Settings and their catalogs gate STT and TTS independently by configured
presence. Unknown or absent optional voice modules stay hidden; a confirmed
absent voice deep link falls back to LLM settings without saving preferences.
A TTS-only configuration does not expose STT or dialog settings. Configured but
unavailable modules retain diagnostic controls. Bootstrap coalesces capability
discovery, and a failed optional read does not trigger automatic retries;
opening Settings or explicitly retrying can request discovery again.
The closed native LLM select stays within its settings pane on desktop and
mobile; its expanded operating-system menu remains native. These regressions
belong to the UI owner, while Core verifies the installed archive and its
settings/universal-search integration.

The first-chat model picker uses effective account settings supplied by Core.
The access response is a deny-list, so its entries and shared catalog order
cannot determine deployment fallback. A denied conversation override resolves
through the authoritative conversation context snapshot; unresolved access or
snapshot reads keep selection unavailable. Selecting a model before a draft
has a conversation persists only model fields, and sending waits for that save.
Failures preserve the draft; navigation and unmount guards prevent stale sends.


## Chat UI and timeline: thread-cost

A successful thread reset can return `summary.source: 'fallback'` when model
summarization fails or is unavailable. The optional field lets clients label the
summary as simplified; its absence is valid for older and model-generated
summaries. This Core contract does not itself add an owner UI label.

For `thread-cost` / `threadReset` chat-settings lookup, the verified Core-facing
contract is [Thread cost client contract](protocol.md#thread-cost-client-contract),
and reset execution is [Session cost and summary reset](llm.md#session-cost-and-summary-reset).
The server accepts summary-preserving reset at POST `/api/conversations/:id/thread-reset`
with `summarize: true` (also the default), rejects active turns with 409
`turn_active`, and persists the reset mode through revisioned conversation-settings
PATCH. The shared baseline has no cache/output breakdown; clients must not invent one.

This checkout is Core (`voiceAIChat`), despite the task's Core UI project label.
Renderer implementation belongs to `sislex/sislexa-core-ui` (`core-ui:README.md`).
Neither `ThreadCostPanel` nor the requested `chat-ui-and-timeline` topic or its DOM
tests exists here. Consequently, this diff verifies Shared exports, route builders
and settings validation, not panel rendering, confirmation/busy states, displayed
numbers, actual `claude.done` refresh wiring or 404 hiding. The reported panel
behavior still needs verification in the UI owner's source; do not treat the
consumer requirements in the protocol topic as evidence of a deployed UI change.

## Independent browser chat hosts

Core's E07 adapter exposes `POST /api/chat/session` for SDK E02 and UI E06.
An exact Origin allowlist protects cookie exchanges and REST/WS admission.
Five-minute memory-only handles retain the live Identity session/grant,
selected tenant and origin. E02 public Bearer and paired backend application/user
credentials retain delegated scopes and cap handle expiry to the live grant.
Handles cannot authorize unrelated APIs or mint more
handles. Ordinary sessions support authenticated settings and uploads.
Delegated sessions additionally bind a conversation, remain default-disabled,
and preserve the text-only grant boundary and Billing requirement. Standalone
sockets exchange `chat.connect`/`chat.ready` without shell subscriptions.

The pinned-SDK external fixture and commissioning details are in
[browser integration](../browser-chat-integration.md). Its real browser suite is
`e2e/externalChat.e2e.test.ts`; Core owns transport/authentication integration,
while the E06 page/widget skins remain owned by Core UI. Sandbox execution of
the browser suite fails on loopback `EPERM`; a supervisor must run the full
gate and operator commissioning remains separate from code completion.

## Independent Agent and Desktop owners

As of the September 22 extraction, `sislex/agent` owns the companion runtime,
protocol, installer generators, tray and enrollment application. `sislex/desktop`
owns Electron main/preload/windows, legacy import and packaging. Their internal
tests and source directories are removed from Core. Both owners install and gate
without a sibling Core checkout. Desktop 1.0.3 consumes pinned Agent and Core UI
archives. The frozen chat-client 1.0.1 package supplies only legacy migration DTOs;
its renderer is no longer selected. Core UI publishes the shared renderer from its
own repository. Desktop does not compile Core UI source. The current renderer pin is documented above; the following entries describe
earlier owner releases. Since 1.4.12
it recovers the project list when the browser read cache supersedes the startup request
(retry once, then an error state with retry instead of an endless load); 1.4.13 also
never strands detail-only project tabs (Release Center, settings, code) behind their
skeleton when the detail load is dropped; 1.4.14 adds managed environment controls and the
stand lifecycle to the Environments block (environments-v2 C10/C11, `@voicechat/shared` 0.1.15);
1.4.15 adds module machines, links, the stand data source, read-only external task cards and
project integration tokens (environments-v3 C20, `@voicechat/shared` 0.1.16).
1.5.0 adds the environments v4 UI (C29), `@voicechat/shared` 0.1.18 with `@sislexa/agent-contracts`
1.2.1, and chat service data loaded only on the «Загружать служебные данные ответов» conversation
setting with an on-demand «загружено X из Y МБ» progress bar and one conversation request
(make-chat-service-data-v1 C03).
1.5.1 keeps the timeline still while typing: the shell and `SharedChat` ignore composer-only state,
so a keystroke re-renders only the composer (a 360-message Make chat spent ~440 ms per key).
1.5.2 opens long chats with only the latest 40 messages and renders earlier ones on demand.
1.5.3 loads history in pages of 50 (`conversations:get` with `limit`/`before`), virtualizes the timeline
(memoized `MessageRow`) and pins agent contracts 1.2.2 (reliability-v2 C01).
1.5.4 adds the knowledge base module selector (kb-service-v1 C02).
1.5.5 adds the UI dev mode and the dev stands section (dev-lane-v1 C04), shared 0.1.25 and agent contracts 1.3.0.
1.5.7 adds the Core UI knowledge base (kb-service-v2 B03).
1.5.9 fixes the phone task modal (title row with ⋯ and ✕, wrapping description) and project header tabs, makes external task cards readable, loads the board when the subprojects endpoint is absent, and adds the `SISLEXA_STORYBOOK_HMR=0` Storybook mode for Make's machine-bridge frames (mobile-fixes-v1, stand-fixes-v1, followup-fixes-v1/v2, storybook-bridge-v1/v2).
1.5.6 adds the release disk preflight with the «Разобраться в чате» cleanup chat in Release Center (release-disk-preflight-v1 C02), asynchronous dev stand operations with gateway urls (dev-lane-v2 B02) and shared 0.1.26.
Desktop 1.0.28 (owner commit `1b3afd4a`, agent 0.23.0, agent contracts 1.3.0) embeds the same renderer;
`scripts/shared-chat-artifacts.mjs` rejects a Desktop archive with another one, unless Desktop is frozen. Standalone chat-app/chat-ui archives remain
at their compatible versions until Make and Web Reader owners update their exact
peer dependencies.

**Desktop is frozen (since 2026-10-18).** Nobody uses Desktop now, so the owner froze its development and
testing. The Desktop rows in `dependency-snapshots.json` and `vendor/owner-artifacts.json` carry
`frozen: {since, reason}`. While frozen, the pinned Desktop archive (1.0.41) stays installed and served, but
`verifySnapshot` skips the Desktop renderer provenance and embedded-renderer checks, and a Desktop pin
change selects only pin-integrity checks in the application gate (no frontend browser suites). Core UI
releases therefore no longer require a Desktop release: release Core UI and pin only Core UI. Electron
QA stays opt-in (`VC_ELECTRON_TESTS=1`). To unfreeze, remove the `frozen` keys, release Desktop with the
current Core UI and pin it; the renderer checks apply again.

Core browser integration uses the published Core UI renderer, Desktop preload and its own Electron
test dependency, with no `npm ci --prefix apps/desktop`. Desktop's owner gate
checks migration/configuration, then launches real Electron and exercises server
setup, chat login rendering, persisted origin and preload isolation. First-time
origin selection reloads the thin client; the obsolete embedded-backend relaunch
has been removed. DMG builds are explicit and do not implicitly publish releases.

Desktop 1.0.2 serves its packaged renderer from the secure `sislexa://app` scheme.
Core allows that exact CORS origin by default. HTTP(S) stays in Chromium; the client
does not intercept remote requests or relax browser security. Owner QA exercises
real API login transport, HttpOnly cookies and denial of unrelated origins. Older
Core deployments require `VC_CORS_ORIGINS=sislexa://app`. The native test entry uses
top-level await so privileged scheme registration finishes before `app.ready`.

The historical monorepo paths in older sections below describe the pre-extraction
layout. Current sources and internal commands are in the owner READMEs.


## Desktop (`apps/desktop`)

Desktop — Electron main/preload/renderer вокруг удалённого server. Он намеренно исключён из корневых npm workspaces: Electron и native `better-sqlite3` имеют отдельный lockfile/node_modules.

Main process создаёт основное окно, tray, external-link policy и хранит выбранный server URL в `remote.json`. Renderer использует тот же `installRemoteBridges`, что web; preload публикует только Electron-специфичные операции настройки URL, legacy migration и agent-mode windows. STT, TTS, LLM и новая БД не живут в desktop.

При первом запуске экран `remote-setup` просит адрес backend, нормализует/проверяет health и сохраняет его. После этого основное окно загружает общий UI. Смена адреса относится к host config и требует пересоздания remote connection.

Удалённый renderer использует credentialed REST (`credentials: include`) для всех мостов. `VC_CORS_ORIGINS` дополняет серверный allowlist обязательными dev-origin `http://localhost:5173` и `http://127.0.0.1:5173`; Fastify отвечает на `/api/*` preflight до auth и отражает только точный разрешённый origin, без wildcard. Для разрешённого cross-origin HTTPS входа session/CSRF cookie получают `SameSite=None; Secure`; `/api/session/me` возвращает CSRF только уже cookie-авторизованному клиенту, поэтому после перезапуска Electron renderer восстанавливает пользователя, CSRF-контекст и WebSocket, не читая HttpOnly token. Login до `fetch` запрещает пароль для удалённого HTTP; исключения — `localhost`, `[::1]` и `127.0.0.0/8`. HTTP-ответы входа сохраняют backend `error`, а rejected fetch показывается как отдельная сеть/CORS-недоступность.

### Legacy migration

`src/main/db` — read-only по смыслу адаптер старой `userData/voicechat.db`. После успешного входа renderer/main формирует `DesktopMigrationBundle` и отправляет его в `/api/migrations/desktop`. Серверный импорт идемпотентен по id разговоров/сообщений.

`remote.json` запоминает URL, для которого migration завершена. Один и тот же локальный архив может быть импортирован на другой выбранный сервер. Исходный файл автоматически не удаляется: это страховка и пользовательские данные.

`better-sqlite3` необходимо пересобирать под текущий ABI: `rebuild:node` перед Vitest, `rebuild:electron` перед dev/dist. Ошибка ABI обычно означает пропущенную пересборку, а не повреждение БД.

### Режим компаньон-агента

`agentMode.ts` позволяет desktop параллельно запускать локальный `@voicechat/agent`, а renderer-страницы setup/log управляют соединением. Это оболочка запуска; exec/fs/pty остаются реализацией `apps/agent`. Tray даёт быстрый доступ к основному окну и режиму машины. Machine token хранится зашифрованным через Electron `safeStorage`, рабочим корнем агента служит домашний каталог пользователя.

Electron preload должен сохранять `contextIsolation` и публиковать минимальный API через `contextBridge`. Node primitives не выдаются renderer. Навигация и `window.open` валидируются и отправляются во внешний браузер только для разрешённых URL.

### Сборка

`electron-vite` собирает main, preload и renderer. Main bundle — ESM, поэтому пути к preload/renderer вычисляются через `dirname(fileURLToPath(import.meta.url))`; CommonJS-глобальная `__dirname` в packaged приложении не определена и оставляет процесс только с tray/menu-bar без `BrowserWindow`. `electron-builder.yml` определяет app id, ресурсы и macOS DMG; `afterPack.cjs` выполняет package-specific обработку. Сервер может найти DMG автоматически в `apps/desktop/release` или получить путь через `VC_DESKTOP_APP`, после чего раздаёт `/api/app/desktop`.

Команды: `npm --prefix apps/desktop install`, `npm run typecheck:desktop`, `npm run test:desktop`, `npm --prefix apps/desktop run dev`, `npm --prefix apps/desktop run dist`.

## Границы безопасности Electron

- renderer не получает `fs`, `child_process`, token store или произвольный IPC;
- preload валидирует аргументы и использует фиксированные channel names;
- server URL нормализуется до сохранения, credentials не включаются в URL;
- внешние ссылки открываются системно, а не навигируют privileged window;
- agent token показывается только там, где это явно нужно для setup;
- логи дочернего агента ограничиваются по размеру и не должны печатать token.

## Где делать изменение

| Изменение | Место |
|---|---|
| Новый экран/виджет чата | `packages/ui` |
| REST/WS реализация web и desktop | `packages/ui/src/remote` |
| URL/proxy/bootstrap браузера | `apps/web` |
| Окно/tray/server config/legacy import | `apps/desktop` |
| Login/enrollment текущего Mac и ARM64 DMG | `apps/login-application` |
| Exec/fs/pty/telemetry машины | `apps/agent` |
| Setup/log/permissions упаковки агента | `apps/agent-tray` |
| Пользовательские machines/terminal/files/LLM history/KB/CI monitor/diagnostics | `packages/operations-app` |
| Administration: users/access/history/usage, LLM engines и model prices | `packages/admin-app` |

Operations-код не знает `window`, fetch, WebSocket, SSE или Electron. Публичные интерфейсы `MachinesClient`, `TerminalClient`, `FilesClient`, `LlmObserverClient`, `KnowledgeClient`, `CiMonitorClient`, `DiagnosticsClient` и `ConsoleClient` описаны в `packages/operations-app/src/contracts.ts`; transport adapters поверх существующих host bridges в этом срезе ещё не добавлены. Транспортные протоколы не менялись.

Administration также не знает прямых transport API. `packages/ui/src/clients/browser.ts#createAdminClient` — host adapter существующего `RendererApi`: он переводит IPC channel names в методы публичного `AdminClient`. REST bridge остаётся в `packages/ui/src/remote/httpApi.ts`; backend и Electron preload не менялись.

**typecheck:desktop и типы Vite-суффиксов.** `apps/desktop/tsconfig.web.json` включает `packages/ui/src/global.d.ts` и `vite-worker.d.ts` (объявления `*?raw`/`*?worker` для воркеров Monaco): без второго tsc десктопа не знает про импорты в `components/code/monacoSetup.ts`. Фикстура настроек в `src/main/db/database.test.ts` строится спредом `DEFAULT_SETTINGS` — новое обязательное поле `Settings` больше не ломает тест (roadmap-2 п.6).
