---
title: Интерфейс: React, store, remote-мосты и голосовой UX
updated: 2026-10-07
areas:
  - apps/server/src/browserUi
  - packages/shared/src/browserUiRelease.ts
  - scripts/application-frontend.mjs
  - scripts/application-frontend-server.mjs
  - apps/server/src/routes/applicationFrontends.ts
  - packages/shared/src/uiPerformance.ts
  - apps/server/src/routes/uiPerformance.ts
  - apps/server/src/server.ts
  - packages/shared/src/protocol.ts
  - apps/server/src/turns.ts
  - packages/shared/src/types.ts
  - apps/server/src/db/database.ts
  - apps/server/src/db/repos
  - apps/server/src/routes/rest.ts
  - scripts/core-ui-artifact.mjs
  - scripts/core-contracts-release.mjs
---

# Интерфейс: React, store, remote-мосты и голосовой UX

Module details: `core-ui:README.md`
Module details: `web-reader:README.md`
Module details: `playwright-reader:README.md`
Module details: `make:README.md`
Module details: `ui:README.md`
Module details: `kanban:README.md`
Module details: `image-studio:README.md`

## Core UI owner and consumer boundary

The browser client, Desktop renderer, shell, chat, projects, operations and administration views are owned by [`sislex/sislexa-core-ui`](https://github.com/sislex/sislexa-core-ui). Core has no UI source workspaces or internal frontend unit tests. Historical `packages/ui`, feature-package and `apps/web` paths below refer to that owner repository.

Core consumes `@sislexa/core-ui` as an immutable archive. `scripts/core-ui-artifact.mjs` validates source provenance, API compatibility and every static asset hash. The Core Docker build verifies the archive and serves its `web` directory; it does not compile React or Storybook. The owner publishes its browser, renderer and Storybook outputs together. UI Kit/Foundation remain independent dependencies owned by `sielexa-ui`.


The owner now groups composition views/tests under `packages/ui/src/modules/`
(Shell, Chat, Projects, Operations, Admin), with explicit public screen entries.
Portable packages expose separate contract/store/route exports. Common runtime,
transport and styles remain composition infrastructure. Local edit gates run
complete selected groups plus Shell integration; detailed timings and selection
examples live in the owner's `docs/kb/ui.md` and `docs/benchmarks/`.

Core also supports browser-only releases through `apps/server/src/browserUi/`. A browser
manifest records clean source provenance, explicit Core API/host version ranges
and every asset hash. `GET /ui/runtime.json` advertises the running Core API and
host versions plus effective/configured activation generations. A versioned
`/ui/releases/<version>-<full-sha>/` asset base keeps old-tab imports valid after
activation. Root HTML uses `no-store`; immutable asset responses use one-year
caching. Unknown versioned assets return 404, never SPA HTML. API, authentication,
Recorder and product panel routing remain separate. See `deploy.md` for rollout
and recovery commands. The bundled package remains the fallback and is still
verified during a Core image build.

Core publishes `@voicechat/shared` contracts with `build:core-contracts -- --version <version> --commit <full SHA>`. This exporter reads committed files and locked peer versions, excludes internal tests and records the source SHA. UI installs the contract archive without a Core checkout. Legacy published `@shared/*` imports resolve to that installed contract, not sibling source.

Conversation groups follow the same owner boundary: Core owns contracts, transport and persistence, while `sislexa-core-ui` owns the responsive rail, store and component QA. The complete server semantics are documented in [conversation-groups.md](conversation-groups.md).


## Story ownership after repository extraction

Product story discovery and accessibility checks run in the Make, Image Studio,
Web Reader, Playwright Reader and Identity repositories. Their UI workspace
`stories.a11y.dom.test.tsx` composes all local stories with UI providers and uses
the shared axe serious/critical policy. Core's Storybook and axe shards include
only Core modules; no `node_modules/@sislexa` story globs or product-story shims.
Core-owned examples may still embed public external widgets and load their styles.
See `testing-operations.md` for browser-test transfer and remaining extraction work.
## External UI library ownership

The authoritative UI Kit/Foundation source and internal test suites are in
[`sislex/sielexa-ui`](https://github.com/sislex/sielexa-ui), released together as
v1.0.2 (UI Kit 0.1.3, UI Foundation 0.1.5). Core installs immutable archives and
has no corresponding source workspaces. Historical paths below identify owner
package paths, not editable Core directories. Use the public package exports for
styles, helpers and runtime ports; never reach through a relative sibling path.

Primitive stories, reduced-motion/focus/touch-size assertions and the Foundation
preference registry checks belong to the UI repository. The Core Skeleton story
retains only its real TaskCard comparison. Core preference checks inspect Core
source; Core stylesheet checks use public CSS exports to verify product integration.
The owner release makes automatic JSX explicit in public TSX files because
consumer dependency optimizers do not inherit the library repository tsconfig.
A standalone packed-consumer render check is part of the owner gate.
Profile/session breakpoint tests live in Identity (PR #6). Core has no local
copies of these assertions. Identity is consumed directly through its public
exports; owner checks run only in Identity. UI Kit/Foundation checks likewise run only
in the UI owner repository.

## Независимые артефакты продуктовых панелей

Make and Reader panels are owner-built artifacts. Core's frontend preparation
verifies their public manifest, source metadata and integrity without rebuilding
them. Owner stories/axe suites run only in their repositories; Core's story
matrix covers Core modules and examples composing public owner widgets.

Реальный `App.tsx` подключает четыре панели через `createApplicationPanel`, включая
surface `shared` у Make; их исходники не импортируются в bundle оболочки.
`installRemoteBridges` на web и desktop настраивает один `applicationHost` адресом
HTTP-сервера. Он читает `/applications/<id>/manifest.json`, проверяет диапазон host
API, загружает JS/CSS по SRI и сверяет регистрацию версии/SHA. React, UI-kit и общие
реестры команд/маршрута предоставляет оболочка: второго контекста React нет.
Ошибка загрузки или render одной панели показывает локальный повтор и сохраняет чат.

IIFE/CSS получают hashed имена и SHA-384 integrity. Ссылка на manifest
не кешируется; старые assets самостоятельного контейнера сохраняются в его
собственном `VC_DATA_DIR/assets`, чтобы открытые вкладки переживали замену версии.
Автоматического GC этого кеша нет; при очистке учитывают живые вкладки и окно rollback.

В разработке сервер читает `packages/*-app/dist`; `dev:web` делает начальную сборку
панелей и следит за их изменениями отдельным управляемым процессом. На площадке
`VC_APPLICATION_FRONTENDS` — JSON-карта id → URL своих статических контейнеров;
ядро раздаёт их через тот же `/applications` gateway. Пустая карта сохраняет
локальный fallback общего Docker-образа; неизвестное приложение/путь не получает SPA.
При сборке вне Git локальный manifest явно имеет `development:true, commit:null`;
OCI-выпуск приложения требует настоящий полный SHA.

Сценарии SRI/смены версии, четырёх реальных панелей, Desktop URL и Monaco находятся
в `e2e/applicationFrontend.e2e.test.ts`. Для публикации UI используются те же
catalog/build/matrix/deploy инструменты, что у backend: [релизы](features/releases.md).

### UI performance telemetry (CHAT-469)

The technical contract/policy is `packages/shared/src/uiPerformance.ts`; the
collector is `packages/ui/src/lib/uiPerformance.ts`. It is separate from
`chatDiagnostics` and sends no diagnostic text. Durations are milliseconds
from one context's `performance.now()`:

| Metric | Start | End | Applicability |
| --- | --- | --- | --- |
| shell_interactive | App module initialization | Authenticated shell with loaded settings and onboarding complete, installed handlers, next frame | Main shell |
| chat_ready | Route layout effect | ChatColumn commit with settings/index ready, requested chat selected and message loading complete, next frame | Chat route |
| account_ready | Route layout effect | AccountPage profile and required tab resources loaded without errors, next frame | Account route |
| board_ready | Route layout effect | ProjectBoard data present, loading false, no error, next frame | Board route |
| message_first_token | Synchronous chat-store acceptance before persistence/network | ChatColumn commits nonempty streaming text or a new AI message, next frame | Text, retry, voice and queued sends |
| message_first_audio | Same accepted-send event | TTS source started and running AudioContext output clock advances | Actual audio; disabled, absent or blocked playback creates no sample |

Cold is the first start of a metric family/normalized screen in a collector
context, warm is a later start. A new document creates a new context. Route
values are only `shell|chat|account|board`, never actual URLs. Platform is
`desktop` for the desktop host, `mobile` for mobile browser user agents, else
`web`; viewport size does not identify desktop. Release commit comes from
`app:ping`, with `unknown` before/unless available.

Message observations remain provisional until generation and playback finish.
Cancellation, interrupted responses, route departure and hidden tabs discard
pending observations; queued sends retain their acceptance time. Local operation
keys never enter payloads. Spans over five minutes are dropped. Missing events
never produce zero; genuine zero durations are valid.

Authenticated `POST /api/ui-performance` accepts at most 32 samples/16 KiB,
rejects extra fields, invalid numbers and metric/route mismatches, and caps ingress
at 600 requests/minute/process. `POST /api/ui-performance/report` uses the
existing administrative permission. The collector keeps at most 32 completed
samples, sends every five seconds with a three-second timeout, and does not retry.
Offline samples expire five minutes after their measured event. Delivery failures
do not log payloads or transport errors. Random batch nonces only deduplicate
delivery; storage has no user, conversation or message association.

Storage is process-local: seven days, 100,000 observations/deduplication entries,
64 release values; restart clears it. Server receipt defines half-open report
periods `[from,to)`; offline delivery belongs to its receipt period. Client and
server wall clocks are never subtracted. Reports allow up to 168 buckets/seven
days and metric/platform/lifecycle/route/version filters. p50/p95 use nearest rank
on raw durations, never averaged percentiles. Count includes only valid filtered
observations. Empty percentiles are null; counts below 20 are insufficient.

`performance:release-check` requires `RELEASE_HEALTH_URL` and full
`RELEASE_COMMIT`, runs gate:fast and checks the health endpoint's exact commit.
It never merges/deploys; the release workflow owns deployment and this check.

## Свои данные: `/api/me/profile` и `/api/me/security`

Страница «Мой аккаунт» доступна любой роли, включая `observer`, и роль-гейта у
неё нет: это данные о себе. Весь префикс `/api/admin/` закрыт привилегией
`users:manage` (`auth.ts:130`), поэтому личные роуты живут вне его: `GET
/api/me/profile` (профиль + машины с живым статусом) и `GET /api/me/security`
(свой журнал). Имени пользователя в пути нет физически — оно берётся из сессии,
подставить чужое некуда. Мутаций `/api/me/*` нет: смена роли, блокировка,
удаление и лимит остаются под `requireAdmin`.

`AdminUserInfo` теперь расширяет `UserProfileInfo`, поэтому обе страницы
принимают один и тот же тип. В нём же `lastSeenAt`/`liveSessions` — метрика
«активны сейчас» считается по последней активности живых сессий с общим порогом
`ACTIVE_WINDOW_MS` (5 минут): `touchSession` обновляет `last_seen` не чаще раза
в минуту, и окно меньше двух минут давало бы ложные «офлайн».

## Формат дат живёт в `@voicechat/shared`

`formatDate`/`formatDateTime`/`isoDate` переехали из `packages/ui/src/lib` в
`packages/shared/src/dateFormat.ts`: ими пользуется и `@voicechat/admin-app`,
который импортировать `@voicechat/ui` не может — тот сам от него зависит. В
`ui/src/lib/dateFormat.ts` остался тонкий реэкспорт. В дашборде админки даты
показывались как `8/28/2026` (локаль браузера), теперь — `28.08.2026`.

## Логи показывают цвет, а не escape-последовательности

`npm`, `vitest` и `tsc` печатают цвет ANSI-последовательностями SGR. Лента шага, merge-терминал и консоль рана выводили их как есть, и каждая строка начиналась с `ESC[1mESC[32m✓ESC[0m`. Разбор — чистая функция `parseAnsi` в `@shared/ansi` (плюс `stripAnsi`/`hasAnsi`). Поддерживается только SGR: перемещение курсора, очистка экрана и OSC-ссылки вырезаются — в статичном логе им нечего делать.

**Грабли на разборе:** `parseAnsi` крутит `exec` в цикле по глобальной регулярке, а `stripAnsi` внутри того же цикла зовёт `replace` — и `replace` обнуляет `lastIndex` общего экземпляра. С одной регуляркой на двоих разбор уходил в бесконечный цикл и вешал весь прогон тестов пакета без единой строки вывода. Поэтому в `parseAnsi` своя копия: `new RegExp(SGR.source, 'g')`.

## Вкладки «Настройки» и QA: подписи и состояния

Статусы QA-ранов подписывают карты из `@shared/qa`: `QA_STAGE_RUN_STATUS_LABELS` (этапный ран), `QA_RUN_STATUS_LABELS` (`ComponentQaRunStatus` и `IntegrationTestRunStatus` — один и тот же набор) и `QA_STEP_STATUS_LABELS` (команда или сценарий внутри рана). Карты полные по типу, поэтому новый статус контракта не собирается без перевода. До них панели печатали сырые `passed`, `gate_failed`, `blocked` вперемешку с русским текстом.
