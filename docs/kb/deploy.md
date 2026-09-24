---
title: Деплой: Docker, HTTPS, прод-сервер, env
updated: 2026-09-24
checked: 4b2c9a4b
areas:
  - scripts/delivery-release.mjs
  - scripts/delivery-release-lock.py
  - scripts/delivery-release-command.py
  - scripts/browser-ui-release.mjs
  - scripts/prod/ui-deploy.sh
  - apps/server/src/browserUi
  - Dockerfile
  - docker-compose.yml
  - docker-entrypoint.sh
  - Caddyfile
  - .dockerignore
  - scripts/prod/deploy.sh
  - scripts/prod/rebuild-when-idle.sh
  - scripts/prod/install.sh
  - scripts/affected-check.test.mjs
  - apps/server/src/config.ts
  - apps/server/src/server.ts
  - apps/server/src/kb/kbMcp.ts
  - apps/server/src/routes/admin.ts
  - packages/shared/src/kb.ts
---

# Деплой: Docker, HTTPS, прод-сервер, env

## Delivery-control release tooling (S0 B05)

`scripts/delivery-release.mjs` exposes the versioned tooling adapter for exact-SHA
owner gates, immutable release-set manifests and observed OCI application releases.
It reuses the existing application catalog, public release contracts and Docker
deployment/rollback adapter. `scripts/delivery-release-lock.py` holds the same host
flock as Core/UI deployment; the durable journal fences epochs, deduplicates
completed effects and blocks new releases after an uncertain outcome until explicit
observation proves recovery. No product runtime or production release is changed
by installing the tooling. The host must provide a trusted live lease verifier and
run authorization before effects can execute.

[Protocol, configuration and B06 handoff](../delivery-release-adapter.md) document
the exact commands, evidence and supported scope. The initial deployment adapter
handles existing OCI applications with unchanged data formats. Independent browser
activation uses its existing owner interface and requires B06 commissioning;
irreversible migrations fail closed. Isolated no-op, failed-release recovery,
interrupted reconciliation and real process-lock tests do not constitute a
production rollout or acceptance of S0.

## Independent browser release rollout (2026-09-22)

Core 0.1.327 (`38dbc3b5adf81aaa4d952c5135bb490978c30f9c`) was deployed through
`voicechat-deploy` at 16:01:59 UTC. The initial mechanism deployment replaced only
Core; a comparison of 27 container identities preserved every other container.
All nine managed components passed readiness, and provider grants, revocation,
consumer RPCs and published panel assets passed production probes. The persistent
Compose chain selects `prebuilt-0.1.327.yml` and retains the existing Desktop/client
overlay. Core API/data versions remain 1.1.0/1.0.0.

The verified pre-deployment database dump was restored in an isolated local DB;
rollback configuration/image records are stored under
`/var/backups/voicechat/sislexa-core-ui-327-20260922T160126Z`. The fallback bundle
remains Core UI 1.0.0; browser-only activation has its own manifest and lifecycle.
The first 1.1.0 browser archive was rejected because macOS tar inserted AppleDouble
files after manifest generation. Active UI state stayed unchanged. The owner
publisher now disables filesystem metadata and verifies the packed inventory;
the corrected 1.1.1 archive passed verification after extraction on Linux.

Browser UI 1.1.1 (`28f9fb728cfefbd6dad60e5730fbcf80aae217fb`) is active through
`voicechat-ui-deploy`. Installation, rollback to the bundle and reactivation kept
Core container `b3d63a418efd` and its start time `2026-09-22T16:01:53.828534699Z`
unchanged. Measured server commands took 1.8–2.2 seconds to install, 1.2–1.4 seconds
to roll back and 1.2–1.7 seconds to activate. These are deployment smoke timings,
not latency guarantees. Both legacy bundled assets and versioned release assets
remained available, and root HTML used `no-store`.

Real Chromium acceptance kept an old bundled tab open through the switch: its
unsent draft survived and a previously unloaded Admin screen opened afterwards.
A fresh tab loaded the new versioned entry and the same persisted draft. The probe
must wait for the selected conversation and draft persistence before switching;
input visibility alone can precede asynchronous chat initialization. Users and
standalone Account, Make, Image Studio and both Reader panels passed production
checks without JavaScript errors. Repeated Users/signup API requests returned 200
in 65–105 ms; the Users page opened in 2.3 seconds in that sample. Temporary users,
sessions and conversations were removed. The UI release and archive are published
at https://github.com/sislex/sislexa-core-ui/releases/tag/v1.1.1.


## Core UI owner rollout (2026-09-22)

Core 0.1.326 (`457b62607cba9162cae27f97cb78be3969deaa41`) consumes Core UI 1.0.0
from `sislex/sislexa-core-ui`, source `e5f926d300313c9088c78b35f69026daaa3980aa`.
`VC_WEB_DIR` is `/app/node_modules/@sislexa/core-ui/web`. The runtime image contains
no former Core UI/browser source workspaces. Desktop 1.0.3 consumes the same
renderer; its downloadable installer is pinned in `client-artifacts-0.1.326.yml`.

The installed `voicechat-deploy` completed successfully. Only the Core container
was replaced; the other service container IDs and images were preserved. The
persistent Compose configuration selects `prebuilt-0.1.326.yml` and the matching
client overlay. Core API/data contracts remain 1.1.0/1.0.0. A verified backup was
restored into an isolated database before rollout; rollback inputs remain under
`/var/backups/voicechat/sislexa-core-ui-326-20260922T112218Z`.

Production acceptance verified the exact UI artifact, Users/Account, tool panels,
image storage, provider grants/revocation, companion execution, installer hashes,
Desktop login and Codex completion. Temporary probes were cleaned up.

## Independent browser UI installation

The browser release mechanism is installed by a normal Core deployment. After
that, UI-only changes use `voicechat-ui-deploy`; they do not build or restart Core.
`scripts/prod/install.sh` installs this launcher. It uses the existing `voicechat`
container and the same host deployment lock as `voicechat-deploy`. Installation
copies the owner artifact to temporary storage, assigns it to the server's `node`
user, and runs the release command as that user so persisted assets remain
readable by the API process.

Persistent state defaults to `<VC_DATA_DIR>/browser-ui`; `VC_BROWSER_UI_DIR` can
override it. `releases/<id>/` contains validated immutable files and `active.json`
is replaced atomically under a writer lock. Activation records its actor, previous
release and generation. Installation rejects links, unlisted/missing/corrupt
files, dirty provenance, incompatible APIs and reuse of an ID with a different
manifest. A failed validation leaves the active release unchanged. Direct CLI
calls use `npm run ui:release -- <command>` inside the Core environment. The host
`voicechat-ui-deploy install` command accepts the extracted owner artifact directory,
not the `.tgz` archive; Release Center performs this extraction in its disposable
staging directory before invoking the command.

```bash
voicechat-ui-deploy status
tar -xzf /absolute/path/to/owner-browser-archive.tgz -C /absolute/path/to/extracted-owner-browser-artifact
voicechat-ui-deploy install /absolute/path/to/extracted-owner-browser-artifact
voicechat-ui-deploy rollback
voicechat-ui-deploy activate --release bundled
voicechat-ui-deploy activate --release <version>-<full-source-sha>
```

Project owners can perform the same install, rollback and bundled-fallback
operations from Release Center. The server requires `VC_GITHUB_TOKEN` for the
private `sislexa-core-ui` release catalog and asset download. Release Center
accepts a published semantic version rather than a caller-supplied URL, resolves
the exact tag commit, transfers the archive to the production machine and keeps
a durable idempotent audit record. A successful operation proves that the Core
container identity and start timestamp did not change.

Deploy the owner-built directory containing `manifest.json`, `index.html` and its
assets. The owner builds with the release-specific base, not the legacy `/assets/`
base. The command preflights the live Core compatibility endpoint and requires
Core to acknowledge the new generation. Existing releases are retained for open
tabs and rollback. A Core upgrade can reject a previously selected UI; the runtime
then keeps a verified in-memory selection or the bundled UI. The configured
activation generation remains visible so the operator can explicitly select a
compatible release or `bundled` without restarting the API.

Verification must compare Core container ID/start time before and after install
and rollback, check `/ui/runtime.json`, root HTML and versioned assets, and probe
`/api/health` and authenticated API routes. Unit/CLI tests and a real Chromium
consumer test cover switching, old-tab lazy imports/drafts, simultaneous HTML
requests, rollback and API authentication. Production acceptance is recorded
in the rollout section above.

## Development preview operation

Development preview is disabled unless the kanban process has `VC_DEVELOPMENT_PREVIEW_ENABLED=true`. Configure `VC_DEVELOPMENT_PREVIEW_IMAGE` to a trusted image containing matching Linux `/app/node_modules`, and `VC_DEVELOPMENT_PREVIEW_GUARD_IMAGE` to the network guard built from `apps/server/docker/development-guard.Dockerfile`. Both accept immutable `sha256:<id>` or repository digest references, never mutable tags. The selected production Runner must expose scoped grants and be reachable from the gateway container.

Each run gets a hash-derived Compose project, an internal application network, an egress gateway, private dependency/test-data volumes, resource limits, a read-only source snapshot and dropped application capabilities. A privileged-capability guard (NET_ADMIN only) owns the application's network namespace and permits outgoing HTTP only to the fixed gateway. The gateway publishes a dynamically allocated loopback application port and forwards only text-generation requests to the selected Runner. Its egress network has explicit gateway priority; Docker Desktop can otherwise return an unpublished port for a multi-network service.

Build the guard with `docker build -f apps/server/docker/development-guard.Dockerfile -t development-preview-guard apps/server/docker`, inspect its immutable ID, then configure the kanban process. A cached compatible base can be selected with the build argument `BASE_IMAGE`.

Use the run's preview status/logs tools for diagnosis. `feature_disabled`, `isolation_rejected`, `gateway_unavailable`, `docker_missing`, `docker_unavailable`, `network_unavailable` and `health_timeout` identify distinct startup failures. Application logs are bounded and redact current scoped/test secrets. After process restart, raw container logs are not exposed without the in-memory redaction values.

Stop through the run API/MCP first; it revokes the Runner grant, closes Chromium, runs `docker compose down --volumes --remove-orphans` against that run's generated Compose file, and deletes only its disposable snapshot directory. The collector retries known failed cleanup on machine reconnect. Inspect candidate orphan containers with `docker ps -a --filter label=com.docker.compose.project=<exact-vc-dev-name>`; do not run global volume prune. Lost persisted metadata requires operator reconciliation rather than guessing paths.

An opt-in real integration test is available with `VC_TEST_DEVELOPMENT_DOCKER=1 npm run -w @voicechat/server test -- src/ci/developmentPreviewDocker.integration.test.ts`. It uses a cached runtime image (override `VC_TEST_PREVIEW_IMAGE`) and a local `chat447-network-guard` image, a synthetic gateway and SQLite seed, then checks restart, blocked egress, source exclusions and cleanup. It does not invoke production CLI.

Пошаговый рантайм-гайд — `docs/docker.md`. Здесь то, что важно понимать до правок.

## Браузерные проверки задач: пара переменных

`VC_BROWSER_PREVIEW_BASE` (сервер) и `VC_BROWSER_PREVIEW_ORIGIN` (browser-runner)
задают один и тот же адрес сервера внутри сети compose (по умолчанию
`http://voicechat:8787`). Сервер по нему строит адрес прокси превью для
изолированного Chromium, а раннер по нему доверяет серверу как оркестратору.
Значения обязаны совпадать: разошлись — и браузерная проверка задачи молча
показывает белый экран с `ERR_BLOCKED_BY_CLIENT`, потому что SSRF-гейт раннера
режет адрес после DNS-резолва. Подробности —
[features/playwright-reader.md](features/playwright-reader.md).

### Операторские алиасы Web Reader

`VC_BROWSER_HOST_ALIASES` — операторский список точных пар публичный `host:port` → внутренний транспорт. В `docker-compose.yml` он передаётся `voicechat`, standalone-сервису `reader` и `browser-runner`, поэтому embedded и remote Web Reader используют ту же конфигурацию, что Chromium. Reader разбирает переменную через security-модуль browser-runner и передаёт карту в `/api/preview` (`apps/web-reader/src/module.ts`, `apps/web-reader/src/routes/previewProxy.ts`). Это нужно, когда сохранённый публичный URL доступен с хоста, но hairpin-запрос из контейнера таймаутится и раньше превращался в 504.

Алиас не расширяет пользовательские права на сеть: исходный публичный hostname проходит SSRF-проверку на каждом редиректе, внутреннюю цель выбирает только заранее настроенная оператором точная пара, а прямые loopback/private URL, другой порт, смешанный публично-приватный DNS и редиректы во внутреннюю сеть остаются запрещены. В переписанном ответе остаётся исходный публичный адрес, внутренняя цель клиенту не раскрывается.

## Образ

Core's `Dockerfile` builds Core-owned server, Kanban, Machines, Admin,
Automation and Storybook targets. Extracted services use immutable images built
in their owner repositories; there are no Core build stages for LLM Runner,
Chromium, Voice, Make, Readers, Identity, Billing or Image Studio.

The backend runs TypeScript through `tsx`, so the runtime keeps its source,
installed dependencies and built host UI. Native `better-sqlite3` requires the
Debian/glibc build toolchain. Product panels and Web Recorder are verified
owner-built assets, never compiled from a copied owner workspace. Recorder
assets are served at `/web-recorder/` outside the host SPA fallback.

Core installs no Claude/Codex, Whisper or Piper binaries. Runner images own their
pinned tools. The Core entrypoint retains `gosu` for data-volume ownership and
runs the service as `node`. Local `browser-runner:local` consumes
`SISLEXA_BROWSER_RUNNER_IMAGE` or the pinned Reader image; it no longer invokes a
removed Core Docker target. Operators can build that image in the Reader repo
and set the override when private registry credentials are unavailable.

`VC_LLM_RUNNER_CLAUDE_URL`, `VC_LLM_RUNNER_CODEX_URL` and
`VC_LLM_RUNNER_TOKEN` configure remote execution and management. Runner 0.3.1 is
the pinned management-compatible release. Core no longer creates local CLI
profiles when these endpoints are absent. Legacy authentication/volume migration
notes below describe historical layouts; active production uses the independent
runner host and owner deployment procedure.

## Аутентификация CLI живёт в контейнере

Логин CLI теперь живёт не в контейнере сервера, а в контейнерах исполнителя:
`runner-work` и `runner-personal`. Персональные профили пользователей лежат внутри
`VC_DATA_DIR/cli-users/<base64url(user)>`; сервер видит только HTTP API
исполнителя и bearer-токен к нему. Общий `HOME` исполнителя нужен лишь как seed
для auth/config.

`runner-work` переиспользует прежние volume `vc-claude` / `vc-codex`, поэтому рабочая
авторизация переезжает без повторного логина. Его профили пользователей теперь
живут в отдельном volume `vc-runner-work-data`; при первом старте entrypoint
копирует туда старое дерево `vc-data:/data/cli-users`, чтобы не потерять
историю сессий, usage и generated images. `runner-personal` хранит свои volume
авторизации и профилей отдельно и требует одноразового `claude auth login` внутри
контейнера.

Для осознанного общего сервисного аккаунта Codex включите у исполнителя
`VC_CODEX_SHARED_AUTH=true`. Тогда `.codex/auth.json` каждого пользовательского
профиля перезаписывается общим источником при каждом запуске (`seedFile(..., overwrite=true)`
в `cliProfiles.ts`); истории, сессии и рабочие каталоги остаются раздельными.
По умолчанию режим выключен.

**Источник общего auth зависит от `VC_CODEX_SHARED_AUTH_USER`, и это ловушка при
`codex login`.** Если переменная задана (напр. `admin`), источник — не `HOME/.codex/
auth.json`, а профиль этого пользователя: `<dataDir>/cli-users/<base64url(логин)>/.codex/
auth.json` (в проде `/data/cli-users/YWRtaW4/.codex/auth.json` для `admin`; `YWRtaW4`
= base64url `admin`). Пустая переменная — источник действительно `HOME/.codex/auth.json`.
Поэтому обычный `codex login` внутри `runner-work` пишет в `HOME` (`/home/node/.codex`)
и **не вступает в силу**: раздаётся всем по-прежнему старый токен из профиля админа,
а ходы Codex падают с `401 invalid_refresh_token` (токены ChatGPT-логина протухают).
Логиниться нужно в профиль-источник:

```bash
docker exec -it -e CODEX_HOME=/data/cli-users/YWRtaW4/.codex \
  voiceaichat-runner-work-1 codex login
```

либо, залогинившись в дефолтный HOME, скопировать результат в профиль-источник
(`cp -f /home/node/.codex/auth.json /data/cli-users/YWRtaW4/.codex/auth.json`).
После этого фикс расходится на остальных сам — профили пересеиваются на следующем
ходе, перезапуск контейнеров не нужен. Codex установлен только в `runner-work`
(в `runner-personal` он выключен через `VC_CODEX_BIN=/bin/false`). Проверка
живого токена: `codex login status` говорит «Logged in» и на протухшем токене —
доверяй не ему, а реальному прогону `echo … | codex exec --json --skip-git-repo-check -`
(инцидент 2026-08-25).

Практическое следствие: при проблемах с проводником CC/Codex, `imageRelocate` или
`/api/auth/status` смотреть нужно не файловую систему контейнера сервера, а
профиль пользователя внутри соответствующего исполнителя. Именно исполнитель
читает `/v1/auth/status`, `/v1/files/read`, `/v1/fs/cc/*` и `/v1/fs/cx/*`; bind-mount
общих `.claude` / `.codex` в серверный контейнер для этих функций больше не нужен.

## HTTPS по IP

`getUserMedia` (микрофон) работает только в secure-контексте, а у прода нет
домена. Поэтому рядом с приложением стоит Caddy с `tls internal` и
`default_sni <ip>` (браузер при заходе по голому IP не шлёт SNI). Сертификат
локального CA — предупреждение браузера принимается один раз. Порты 80→443
редиректом. Локальный CA и сертификаты — в томе `vc-caddy`.

## Ротация логов контейнеров

Все семь сервисов основного `docker-compose.yml` используют общий YAML anchor
`default-logging`: драйвер `json-file` ограничивает один файл 10 МБ и хранит не
более трёх файлов на контейнер. Настройка относится к `voicechat`, `stt-runner`,
`automation-runner`, обоим LLM runner, `tts-runner` и `caddy`; источник истины —
`docker-compose.yml`.

## Память контейнера — это не просто лимит

`mem_limit` читается автоопределением ресурсов через cgroup и напрямую включает
или выключает распознавание речи (см. `stt-tts.md`). При `1g` доступна модель
`small` и TTS; для `small+medium` нужно `1536m`, для `large-v3-turbo` — 2 ГБ+.
Меняешь `mem_limit` — знай, что меняешь набор возможностей приложения.

Production-хост имеет 2 CPU, поэтому лимит `cpus` любого сервиса в
`docker-compose.yml` не должен превышать `2`. Большее значение Docker отклоняет
при создании контейнера (`range of CPUs ... only 2 CPUs available`) ещё до
запуска health check; для `stt-runner` установлен лимит `cpus: 2`.

## Переменные окружения

**Playwright Reader отдельным сервисом (2026-09-09).** В compose приложение
`playwright-reader` включено по умолчанию, как Make: образ `voicechat-playwright-reader`,
стадия `playwright-reader-runtime`, порт 8797. У ядра уже заданы
`VC_PLAYWRIGHT_READER_MODE=remote` и `VC_PLAYWRIGHT_READER_URL=http://playwright-reader:8797`.
После объединения со студией картинок порт 8796 оставлен ей; разные значения
по умолчанию позволяют запускать оба standalone-процесса на одном хосте.
Новые обязательные строки в `.env` не нужны: сервис получает существующие
`VC_INTERNAL_TOKEN` и `VC_BROWSER_RUNNER_TOKEN`. Его `VC_CORE_URL` ведёт на ядро,
`VC_BROWSER_RUNNER_URL` — на Chromium. Своей БД, тома данных и MCP-секрета у него нет.
Caddy направляет `/api/browser/*` в приложение; при заходе на порт ядра эти пути
переправляет `playwrightReaderBridge/proxy.ts`. `/internal/*` снаружи закрыты.

В dev/desktop режим по умолчанию `embedded`. Для отдельного процесса вне compose
ядру нужны `VC_PLAYWRIGHT_READER_MODE=remote`, `VC_PLAYWRIGHT_READER_URL` и общий
`VC_INTERNAL_TOKEN`; приложению — `VC_CORE_URL`, тот же токен, URL/токен browser-runner.
Запуск: `npm run -w @voicechat/playwright-reader start` (`PORT=8797`, `HOST=127.0.0.1`).
`VC_BROWSER_PREVIEW_BASE` задаёт доступный Chromium адрес прокси (fallback —
`VC_MCP_PUBLIC_BASE`, затем `VC_CORE_URL`); он должен совпадать с разрешённым
`VC_BROWSER_PREVIEW_ORIGIN` раннера. Отдельный Web Reader обращается к приложению
при режиме remote либо к RPC ядра при embedded; его собственный режим независим.
Для возврата compose к embedded надо также убрать прямой маршрут Caddy в приложение.

**Make отдельным сервисом (`docs/plans/make-standalone.md`, 2026-09-07).** В compose Make — сервис
`make` (образ `voicechat-make`, стадия `make-runtime`, порт 8788, `mem_limit 512m`, healthcheck
`/v1/health`), ядро работает в `VC_MAKE_MODE=remote`. Общие переменные обоих сервисов —
`VC_INTERNAL_TOKEN` (Bearer `/internal/*`) и `VC_MCP_SECRET` (секрет `/mcp/*`): дефолты локальные,
для прода задай случайные в `.env`. У ядра ещё `VC_MAKE_URL=http://make:8788` и
`VC_MAKE_MCP_PUBLIC_BASE` (адрес Make глазами контейнера исполнителя, по умолчанию `VC_MAKE_URL`);
у Make — `VC_CORE_URL=http://voicechat:8787` и `VC_DATA_DIR` на **тот же том** `vc-data`
(мастерские лежат в `/data/make`, ядро в них не пишет — миграции данных нет). Пути Make доходят
двумя дорогами: Caddy направляет `/api/make*`, `/api/preview/make*`, `/p/*`, `/s/*` в `make:8788`
напрямую, а при заходе портом 8787 мимо Caddy их переправляет само ядро (`makeBridge/proxy.ts`).
`/internal/*` Caddy отвечает 404, ядро без токена — 401. Перекатить один Make:
`docker compose up -d --build make` — ядро при этом не трогается (Release Center пока пересобирает
всё; отдельный профиль — круг 4 плана). Без compose (dev, desktop) `VC_MAKE_MODE` не задан → Make
встроен в процесс ядра, как раньше.

**Студия картинок отдельным приложением (2026-09-09).** Workspace `apps/image-studio`,
сервис compose `image-studio`, образ `voicechat-image-studio`, target `image-studio-runtime`,
порт 8796, healthcheck `/v1/health` (имя сервиса и `VC_RELEASE_VERSION`), память 512 МБ.
У ядра в compose `VC_IMAGE_STUDIO_MODE=remote`, `VC_IMAGE_STUDIO_URL=http://image-studio:8796`;
у студии — `VC_CORE_URL`, общий `VC_INTERNAL_TOKEN` и `VC_DATA_DIR=/data`. Прежний каталог
`/data/image-studio` доступен через том `vc-data`, переноса формата данных не требуется.
Caddy ведёт `/api/image-studio/*` и `/g/*` в студию напрямую, порт 8787 — через прокси ядра;
`/internal/*` снаружи закрыт. UI собирается с общим web-клиентом. Обновить только студию:
`docker compose up -d --build image-studio`. Вне compose режим ядра по умолчанию embedded;
standalone запускается `npm run -w @voicechat/image-studio start` с теми же переменными
(каталог можно задать через `VC_IMAGE_STUDIO_DATA_DIR`). На один каталог запускается один
экземпляр студии: слоты генераций и лимиты попыток пароля живут в памяти процесса.
The standalone process also requires `VC_MCP_SECRET`, shared with the core and
forwarded by `docker-compose.yml`. The core embeds that secret in a private,
conversation-scoped MCP URL passed only to the selected LLM runner. A missing
secret now fails standalone startup instead of exposing an unusable MCP endpoint.

**Канбан отдельным сервисом (`docs/plans/kanban-service.md`, 2026-09-07).** Профиль compose `kanban`
(образ `voicechat-kanban`, стадия `kanban-runtime`, порт 8789, тот же код `apps/server`, точка входа
`src/kanban/standalone/index.ts`). По умолчанию выключен: у ядра `VC_KANBAN_MODE=embedded`, кластер живёт
в процессе ядра, как раньше. Включение: в `.env` задать `VC_KANBAN_MODE=remote` и `VC_DB_URL` (общая база
**только Postgres** — файл SQLite из двух процессов не открыть), поднять
`docker compose --profile postgres --profile kanban up -d --build`. У ядра `VC_KANBAN_URL=http://kanban:8789`
и `VC_KANBAN_MCP_PUBLIC_BASE` (адрес MCP канбана и CI-команд глазами исполнителя); у канбана —
`VC_CORE_URL`, общие `VC_INTERNAL_TOKEN`/`VC_MCP_SECRET`, `VC_MCP_PUBLIC_BASE` = адрес ядра (MCP машин, KB
и превью остаются у ядра), адреса раннеров LLM/браузера, SMTP и **тот же том** `vc-data` (скриншоты QA и
вложения читаются с диска). Пути канбана снаружи идут только через ядро — Caddy их не выделяет: под
`/api/projects/*` у ядра свои роуты (git-панель, KB), а права проекта проверяет preHandler ядра по пути;
ядро переправляет остальное в `kanban:8789` (`kanbanBridge/proxy.ts`), канбан перепроверяет сессию через
`/internal/whoami`. Откат — убрать `VC_KANBAN_MODE` (данные те же, база общая).

**Машины отдельным сервисом (`docs/plans/machines-service.md`, 2026-09-07).** Профиль compose `machines`
(образ `voicechat-machines`, стадия `machines-runtime`, порт 8793, точка входа
`apps/server/src/machines/standalone/index.ts`). По умолчанию выключен (`VC_MACHINES_MODE=embedded`).
Включение: `VC_MACHINES_MODE=remote` и `VC_DB_URL` (Postgres) в `.env`, `--profile postgres --profile machines`.
У ядра `VC_MACHINES_URL=http://machines:8793`; у процесса машин — `VC_CORE_URL`, общий `VC_INTERNAL_TOKEN`,
`VC_PUBLIC_URL`, тот же том `vc-data`. Компаньон-агенты ничего не меняют: они ходят на публичный хост `/agent`,
ядро переправляет их WebSocket в процесс машин само (Caddy без изменений); REST машин и установщики ядро
проксирует туда же. Откат — убрать `VC_MACHINES_MODE` (агенты переподключатся к ядру сами).

**Админка отдельным сервисом (2026-09-07).** Профиль compose `admin` (образ `voicechat-admin`, стадия
`admin-runtime`, порт 8794, точка входа `apps/server/src/admin/standalone/index.ts`), у ядра
`VC_ADMIN_MODE=remote` + `VC_ADMIN_URL=http://admin:8794`. Требует `VC_DB_URL` (Postgres); у процесса —
`VC_CORE_URL`, общие `VC_INTERNAL_TOKEN`/`VC_MCP_SECRET`, `VC_MAKE_URL`, при вынесенных машинах —
`VC_ADMIN_MACHINES_URL=http://machines:8793` (иначе машины читаются у ядра). Деплой из админки по-прежнему
выполняет ядро (сокет host-side API у него). Откат — убрать `VC_ADMIN_MODE`.

**Распределённый стенд (2026-09-08).** Что где может жить и что для этого нужно:

| Процесс | Точка входа / образ | Режим у ядра | Нужно процессу | Общий том с ядром |
|---|---|---|---|---|
| ядро (чат, БД-миграции, CLI-раннеры, WS клиентов) | `apps/server/src/index.ts`, `server-runtime` | — | `VC_DB_URL` (Postgres), `VC_INTERNAL_TOKEN`, `VC_MCP_SECRET` | — |
| Make | `apps/make/src/standalone`, `make-runtime` | `VC_MAKE_MODE=remote`, `VC_MAKE_URL` | `VC_CORE_URL`, общие токен и секрет, свой `VC_DATA_DIR` (мастерские `/data/make`) | нужен, если Make раньше работал встроенным — мастерские лежат в `/data/make` ядра |
| студия картинок | `apps/image-studio/src/standalone`, `image-studio-runtime` | `VC_IMAGE_STUDIO_MODE=remote`, `VC_IMAGE_STUDIO_URL` | `VC_CORE_URL`, общий токен, `VC_DATA_DIR` | для прежних галерей нужен доступ к `/data/image-studio`; после переноса каталога общий том не требуется |
| канбан | `apps/server/src/kanban/standalone`, `kanban-runtime` | `VC_KANBAN_MODE=remote`, `VC_KANBAN_URL`, `VC_KANBAN_MCP_PUBLIC_BASE` | `VC_CORE_URL`, `VC_DB_URL`, токен, секрет, `VC_MCP_PUBLIC_BASE` (адрес ядра), адреса раннеров LLM и браузера, `VC_MAKE_URL`, SMTP | нет: вложения читаются через порт ядра, скриншоты QA — свой каталог |
| машины | `apps/server/src/machines/standalone`, `machines-runtime` | `VC_MACHINES_MODE=remote`, `VC_MACHINES_URL` | `VC_CORE_URL`, `VC_DB_URL`, токен, `VC_PUBLIC_URL` | нет: установщики — из образа, перенос хранилищ — свой файл |
| админка | `apps/server/src/admin/standalone`, `admin-runtime` | `VC_ADMIN_MODE=remote`, `VC_ADMIN_URL` | `VC_CORE_URL`, `VC_DB_URL`, токен, секрет, `VC_MAKE_URL`, при вынесенных машинах `VC_MACHINES_URL`, SMTP | нет |
| Web Reader (прокси, MCP и iframe-рекордер) | `apps/web-reader/src/standalone`, независимый `build:app -- web-reader` | `VC_READER_MODE=remote`, `VC_READER_URL`, `VC_READER_MCP_PUBLIC_BASE` (также канбану) | `VC_CORE_URL`, `VC_INTERNAL_TOKEN`, `VC_MCP_SECRET`, `VC_PLAYWRIGHT_READER_URL`; БД не нужна | нет: кадры и данные у ядра; cookie сайтов в памяти Reader |

Сеть: Postgres доступен всем процессам; ядро ходит к каждому соседу по его URL, соседи — к ядру по
`VC_CORE_URL` (whoami, RPC, ленты событий); снаружи всё идёт через публичный хост ядра (Caddy → ядро →
прокси), агенты подключаются к публичному `/agent`. Процесс машин держит постоянный WebSocket к ядру и
админке — ему нужен входящий доступ от них. Порты по умолчанию: 8787 ядро, 8788 Make, 8789 канбан, 8793
машины, 8794 админка, 8795 Web Reader. Одновременный старт всех процессов на одной базе безопасен: схему Postgres
ставит тот, кто первым взял advisory-замок (`VoiceChatDb.init()`), остальные ждут (2026-09-08 — до этого два процесса
могли упасть deadlock-ом на `CREATE TABLE IF NOT EXISTS`). Что остаётся у ядра принципиально: чат и ходы модели, WS клиентов, миграции схемы,
раздача web-клиента, сокет деплоя host-side API. Откат любого процесса — снять его `VC_*_MODE` у ядра.

**Прод на Postgres с 2026-09-08 12:06 UTC.** Профиль `postgres` включён постоянно через `COMPOSE_PROFILES=postgres`
в `.env` чекаута (там же `VC_PG_PASSWORD` и полный `VC_DB_URL=postgres://voicechat:…@postgres:5432/voicechat`), поэтому
штатный `voicechat-deploy` поднимает Postgres вместе со всем. Перенос делался так: пробная копия на живой базе
(`VACUUM INTO /data/prod-copy.db` внутри контейнера ядра → `docker compose run --rm --no-deps -w /app/apps/server
voicechat node --import tsx src/db/copyToPostgres.cli.ts --sqlite /data/prod-copy.db --url …`), затем
`docker compose stop voicechat`, свежий снимок, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` в Postgres,
чистая копия (72 с, 113 таблиц, расхождений 0), `VC_DB_URL` в `.env`, `docker compose up -d voicechat` с
`VC_RELEASE_VERSION`/`VC_RELEASE_COMMIT` в окружении (иначе метаданные релиза обнулятся). Простой — 108 с.
База в Postgres — 639 МБ (в файле SQLite 5,2 ГБ живых данных было ~1 ГБ, остальное — пустые страницы после
чистки событий). Откат: убрать `VC_DB_URL` из `.env` и поднять `voicechat` — файл `/data/voicechat.db` не тронут,
но записи после переключения останутся в Postgres. Снимок `/data/prod-copy.db` можно удалить через несколько дней.
Проверка переключения: `SELECT MAX(last_seen) FROM agents` в Postgres растёт, mtime `voicechat.db` стоит.

Полный разбор — `apps/server/src/config.ts` (одна функция `loadConfig`).
Группы: `PORT`/`HOST`; данные и артефакты (`VC_DATA_DIR`, `VC_MODELS_DIR`,
`VC_WHISPER_CLI`, `VC_PIPER_*`, `VC_WEB_DIR`, `VC_WEB_RECORDER_DIR`); раздача сборок
(`VC_AGENT_APP`, `VC_DESKTOP_APP`); первый админ (`VC_ADMIN_PASSWORD`); база на Postgres вместо SQLite (`VC_DB_URL=postgres://…`,
см. [data-auth.md](data-auth.md#схема)); пороги
памяти (`VC_MIN_MEM_STT`, `VC_MIN_MEM_TTS`); входящий gateway
(`VC_CLAUDE_GATEWAY_BACKEND`, `VC_CLAUDE_UPSTREAM_URL`,
`VC_CLAUDE_UPSTREAM_API_KEY`, `VC_CLAUDE_UPSTREAM_AUTH`, `VC_CLAUDE_MODEL_MAP`); GitHub PR merge (`VC_GITHUB_TOKEN`).
`VC_CLAUDE_MODEL_MAP` — JSON-объект; невалидный JSON валит старт с понятной
ошибкой (это осознанно, а не баг). `VC_MCP_PUBLIC_BASE` задаёт базу MCP-URL,
которые сервер отдаёт контейнеру-исполнителю (`/mcp/remote-bash`, `/mcp/kb`,
`/mcp/ci-commands`); без неё в dev/тестах остаётся текущее loopback-поведение
`http://127.0.0.1:<PORT>`. В compose она задана дефолтом `http://voicechat:8787`
и **обязательна**: без неё CLI в контейнере исполнителя стучится в собственный
localhost, где сервера нет, и инструменты `mcp__remote__*`/`mcp__kb__*` просто не
появляются у модели — без ошибки в ленте. Симптом со стороны пользователя:
модель отвечает «remote недоступен, обратитесь в поддержку», а перезапуск машины
и переподключение агента ничего не меняют, потому что машина тут ни при чём.
Сервер теперь предупреждает об этой связке в лог на старте
(`mcpBaseMisconfigured`, `apps/server/src/mcp/publicBase.ts`).

## Прод

### External runner ownership at the September 2026 release checkpoint

Live inspection on 2026-09-20 confirmed that core runs release `0.1.309`
(`5169e54033b2`) with a clean production checkout. Its Compose chain includes
`/etc/voicechat/playwright-reader-recovery.yml` and
`/etc/voicechat/llm-runner-external.yml` after the repository's `docker-compose.yml`.
Both `/etc/voicechat/production.env` and the runtime checkout's `.env` retain
that chain. LLM runner relays are managed separately; a core release must preserve
these overrides and must not recreate the legacy local work/personal runners.
Do not rerun `scripts/prod/install.sh` to deploy an ordinary release: that installer
replaces `production.env`, including additional operator-managed configuration.
Use the installed `voicechat-deploy` entrypoint and verify the effective services
before deployment and the release version/commit afterward.

Этот раздел — инструкция для запросов **«обнови прод»**, **«обновить production»**,
**«обновить контейнер»**, **«пересобрать контейнеры»**, **«задеплоить main»**,
**«задеплоить master»** и **«перезапустить прод»**. Боевой branch этого репозитория
называется `main`; упоминание `master` в запросе означает тот же деплой текущего
`origin/main`, а не другую ветку. В ходе модели такой запрос выполняется только
отдельным MCP-инструментом `mcp__kb__deploy_prod`, а не через remote shell.
Инструмент не принимает аргументов: владельца берёт из серверного контекста
текущего хода, непосредственно перед запуском перечитывает его роль и блокировку
из БД и разрешает вызов host-side `DeployTrigger` только незаблокированному
`admin`. Bearer-токен сессии модели, CLI и удалённому shell не передаётся.
Результат — `accepted`/`running`; отказ и недоступность host API возвращаются
структурированной ошибкой без запуска команды.

Для ручного обслуживания: ssh на прод-хост (сейчас 89.125.68.35). **`target.path`
из настроек Release Center (сейчас `/root/ChatAI`) — это корень данных, а не
чекаут**: внутри лежат `.voicechat`, `chats`, `projects`, `global`, а `.git` там
нет вовсе. Каталог, из которого поднят compose и который обновляет деплой, задан
переменной `VC_REPO_DIR` в `/etc/voicechat/production.env` — это
`<target.path>/projects/<projectId>/environments/production/temporary/repository`
(ниже обозначен как `$PROD`). Проверено на живом проде: рабочий каталог
контейнера `voicechat` совпадает с `VC_REPO_DIR`. Чтобы **обновить
контейнер** на production, обновить прод целиком или пересобрать прод-контейнеры,
всегда выполняй **только `voicechat-deploy`**: нельзя заменять его прямым
`docker compose up`, `docker compose up --build` или ручным перезапуском.
Если команда ещё не установлена, её ставит `bash scripts/prod/install.sh` (см.
ниже).

Перед запуском проверь, что это правильный прод-чекаут на ветке `main`, рабочее
дерево чистое и установлен штатный скрипт:

```bash
cd $PROD
git branch --show-current       # ожидается ветка релиза, например release/0.1.184
git status --short              # ожидается пустой вывод
command -v voicechat-deploy     # ожидается /usr/local/bin/voicechat-deploy
```

После проверок запусти деплой, дождись записи об успехе в логе и обязательно
проверь итоговый health-check:

```bash
voicechat-deploy                # вернётся сразу, деплой идёт в фоне
tail -f /var/log/voicechat-deploy.log
curl -fsS http://127.0.0.1:8787/api/health
```

Успешный результат — в логе есть `деплой успешен`, health-check отвечает без
ошибки. Внутри `voicechat-deploy` выполняются `git pull --ff-only`, обязательная
проверка серверного тома и `docker compose up -d --build`; затем сам скрипт ждёт
`/api/health` до 5 минут. Так обновляются `voicechat`, `runner-work`,
`runner-personal` и `caddy`, а фоновый процесс переживает обрыв канала (см. ниже).

Серверные данные `/data` хранятся в Docker-томе с постоянным именем
`voicechat-server-data`; имя не зависит от каталога checkout или Compose project
name. Тот же том подключён read-only к `runner-work` для переноса CLI-профилей.
`voicechat.db` и `session.secret` являются единым обязательным комплектом:
непустой постоянный том проходит проверку обычного непустого файла для обоих
объектов и SQLite `PRAGMA integrity_check`, после чего всегда имеет приоритет и
не изменяется данными старых томов.

Если постоянный том пуст, deploy ищет прежние Compose-тома по метке
`com.docker.compose.volume=vc-data`. Пустые тома игнорируются; отсутствие
непустого источника означает чистую установку. Ровно один непустой источник должен
содержать корректный обязательный комплект. Перед копированием всё содержимое
источника архивируется и проверяется в отдельном постоянном томе
`voicechat-server-data-backups`, затем копируется в всё ещё пустой канонический
том и повторно проверяется. Старый том не удаляется. Заполненный канонический том
делает последующие запуски идемпотентными и исключает повторное копирование.

Неполный или повреждённый постоянный/legacy-том, несколько непустых legacy-томов,
ошибка списка томов, backup, копирования либо итоговой проверки завершают deploy
ненулевым кодом до `docker compose up`. После частичного сбоя копирования
резервная копия остаётся для ручного восстановления, а следующий запуск
fail-closed остановится на неполном постоянном томе.

Тот же запуск доступен приложению через `POST /api/admin/deploy`. Внешний маршрут
защищён ролью `admin` и проксирует запрос в отдельный host-side systemd-сервис
`voicechat-deploy-api.service` через Unix-сокет
`/run/voicechat/deploy-api.sock`. Сервис принимает только фиксированный
`POST /deploy`, не принимает команду или аргументы из запроса и запускает только
`/usr/local/bin/voicechat-deploy`. Сокет примонтирован в контейнер `voicechat`,
поэтому контейнеру не выдаются Docker socket, каталог `$PROD` или
root-доступ. Успешный запуск возвращает `202 accepted`, занятый deploy-lock —
`409 running`, другой путь — JSON `404`, недоступный host API — `503`. Обработчик
логирует запросы как Unix-клиентов напрямую: `BaseHTTPRequestHandler.address_string()`
для AF_UNIX вызывать нельзя, поскольку он ожидает TCP-кортеж и роняет отправку
ответа с `IndexError`. Unit сохраняет `RuntimeDirectory` при рестарте сервиса:
иначе systemd пересоздаёт каталог, а уже запущенный контейнер продолжает видеть
старый inode bind-mount и получает `ENOENT` вместо нового сокета. Сам сокет принадлежит
UID `1000` (`node` в серверном контейнере) и GID `65532`: `gosu node` сбрасывает
supplementary groups процесса, поэтому одной настройки Compose `group_add`
недостаточно для доступа к сокету.

Секреты (`VC_ADMIN_PASSWORD`, upstream-ключи) задаются в shell/`.env` на сервере и
в репозиторий не попадают.

### Почему нельзя звать `docker compose up -d --build` напрямую

Любая команда, пришедшая через канал «модель → сервер → агент», живёт ограниченное
время: сервер передаёт агенту `timeoutMs` (MCP-мост `remoteBashMcp.ts` — 120 с по
умолчанию, максимум 300 с), а агент по истечении делает `SIGKILL`
(`apps/agent/src/exec.ts`). Через ssh похожая история — SIGHUP при обрыве сессии.
`docker compose up -d --build` в этот лимит не укладывается, и убийство приходит в
самую опасную точку: старый контейнер уже удалён, новый ещё **создан, но не
запущен**. `restart: unless-stopped` не помогает — политика рестарта применяется
только к контейнеру, который хоть раз стартовал.

Симптом (инцидент 2026-07-30): Caddy жив, `https://45.135.182.251/` отдаёт `502`,
`docker compose ps -a` показывает `voicechat` в `Created` без единой строки логов,
а имя контейнера получает хеш-префикс (`<hash>_voiceaichat-voicechat-1` — так docker
разводит конфликт имён при пересоздании; префикс безвреден и уйдёт при следующем
полном деплое). Разовое лечение — `docker compose up -d`: образ уже собран,
не хватает только старта.

### Две линии защиты (`scripts/prod/`)

- `deploy.sh` → `/usr/local/bin/voicechat-deploy` — первым делом перезапускает себя
  через `setsid nohup` и возвращает управление, поэтому смерть канала деплою
  безразлична (проверено: `SIGKILL` по группе процессов родителя, потомок дошёл до
  конца). Дальше — `flock` (лок на дескрипторе, освобождается даже при `SIGKILL`),
  `git pull --ff-only`, `up -d --build`, ожидание `/api/health` до 5 минут; при
  неудаче в лог попадают `ps -a` и последние 50 строк логов контейнера.
- `watchdog.sh` → `/usr/local/bin/voicechat-watchdog`, systemd-таймер
  `voicechat-watchdog.timer` раз в минуту — поднимает контейнер, если тот в
  `created` или отсутствует. Из `exited`/`paused` **не** поднимает: это результат
  намеренного `docker compose stop`. Глушится файлом
  `$PROD/.deploy-paused`. Берёт тот же lock, что деплой, — во время
  деплоя не вмешивается. Лог: `/var/log/voicechat-watchdog.log`.

Установка/переустановка (идемпотентна): `cd $PROD && bash scripts/prod/install.sh`.
Установщик включает и перезапускает `voicechat-deploy-api.service`, чтобы новая
копия обработчика сразу вступила в силу; его журнал читается
через `journalctl -u voicechat-deploy-api.service`, а сам deploy продолжает писать
в `/var/log/voicechat-deploy.log`. `/usr/local/bin/voicechat-deploy` — стабильный
launcher: при каждом запуске он берёт актуальный `scripts/prod/deploy.sh` из
production checkout, сохраняет его как content-addressed неизменяемую копию в
`/usr/local/lib/voicechat` и запускает её. Поэтому обновление checkout не меняет
исполняемый файл посреди `git pull`, а исправления передачи release metadata не
застревают в старой установленной копии.

При отделении через `setsid nohup` launcher явно передаёт фоновой копии
`VC_RELEASE_VERSION`, `VC_RELEASE_SOURCE`, `VC_RELEASED_AT`,
`VC_RELEASE_COMMIT` и `VC_RELEASE_TASK` через `env`. Это часть контракта, а
не необязательное наследование shell-окружения: защищённый release помечает
источник как `protected-release`, и именно его каноническая версия должна дойти
до Compose. Обычный запуск без явной версии по-прежнему берёт строгий тег
текущего HEAD либо публикует неизвестную версию. Перед сборкой лог содержит
version, source, commit и task.

Интеграционный тест этого контракта в `scripts/affected-check.test.mjs` ждёт маркер
от отделённого через `setsid nohup` процесса с интервалом 20 мс максимум 500
попыток, то есть до 10 секунд. Ожидание прекращается сразу после успешного чтения
маркера; увеличен только запас времени теста, рабочая логика деплоя не менялась.

## Прод-каталог заодно рабочая копия — коммит там пушится сразу

`$PROD` — не только прод-чекаут, из которого `docker compose` собирает
образ, но и общая рабочая копия чат-сессий на этой машине. Второй писатель в `main`
— CI-раннер: шаг «Влить ветку задачи в прод-ветку» пушит мерж в `origin/main` из
клона в `repos_root`, а шаг «Обновить прод-контейнер» поднимает прод
**только `git pull --ff-only`** (см. [features/ci-runner.md](features/ci-runner.md)).

Отсюда правило: **закоммитил в `$PROD` — сразу `git push origin main`.**
Незапушенный локальный коммит проходит проверку на локальные изменения (дерево-то
чистое) и разводит ветки в момент, когда CI пушит свой мерж; `pull --ff-only`
падает с `fatal: Not possible to fast-forward` (код `128`), и ран встаёт на шаге
обновления прода. Лечится это на стороне прод-каталога — поднять локальный коммит
в `origin/main` (`git pull --rebase` + `push`, либо влить его через клон), а не
ослаблением `--ff-only`: прод обязан оставаться линейным продолжением `origin/main`,
иначе он собирается из кода, которого ни у кого больше нет.

Длинные правки и гейт держи в отдельном клоне (`docs/kb/features/ci-runner.md` →
`repos_root`), а прод-каталог используй как деплой-чекаут.

## Пересборка прода изнутри рана: собрать сразу, поднять отложенно

Задача «Пересборка прода» (автозадача учёта, `features/ci-runner.md`) выполняется
моделью в ране на том же хосте, где живёт прод, — то есть шаг пересборки убивает
контейнер, в котором работает сам раннер.

Раньше боевой шаг «Обновить прод-контейнер» отодвигал пересборку слепым
`PROD_REBUILD_DELAY=1600`. Задержка защищала **только тот ран, который её
запустил**, а прилетала в середину следующего: раны идут каждые 5–30 минут, и
06.08.2026 пересборка от рана CHAT-112 пересоздала контейнеры в 18:57:16, убив ран
CHAT-115 (он уже влил работу в `main`, но получил `failed`, а карточка откатилась
в To Do) и ран CHAT-116 на первом же шаге. В ленте это выглядит как «Машина
отключилась во время выполнения команды», дальше fix-loop бьётся в исчезнувший
`runner-work`; ретрай невозможен, если cleanup уже снёс рабочую копию.

Поэтому ожиданием управляет `scripts/prod/rebuild-when-idle.sh`, а не задержка:
1. `flock` на `/var/lock/voicechat-prod-rebuild.lock` — несколько отложенных
   пересборок схлопываются в одну, вторая увидит уже собранное дерево;
2. `docker compose build voicechat runner-work runner-personal` — контейнеры не
   пересоздаёт, поэтому идёт при живых ранах;
3. ожидание простоя: раз в 10 с считает раны в активных статусах
   (`queued`/`running`/`awaiting_input`) прямо в `/data/voicechat.db` через
   `docker exec`; недоступный сервер = активных ранов нет. По
   `VC_REBUILD_IDLE_TIMEOUT` (час) сдаётся с кодом `75` и **не** пересоздаёт
   контейнеры — образы уже собраны, поднять их можно позже;
4. `docker compose up -d` + проверка `/api/health` с хоста.

Проверка простоя повторяется прямо перед `up -d`: окно, в которое новый ран успевает
стартовать, сужено до секунд, но не закрыто совсем — мьютекс общего ресурса
(`isSharedResourceCommand`) живёт в процессе сервера, скрипт на хосте его не видит.

Руками зовут тот же скрипт отложенным сеансом: в лимит bash-моста (300 с) не
укладывается даже `build`.

```bash
cd $PROD && git pull --ff-only origin main
setsid nohup sh -c 'cd $PROD && ./scripts/prod/rebuild-when-idle.sh; echo EXIT=$?' \
  > /tmp/voicechat-prod-rebuild-<N>.log 2>&1 < /dev/null &
# ждать повторными дешёвыми вызовами: tail /tmp/voicechat-prod-rebuild-<N>.log
# (sleep внутри команды моста не помогает — таймаут убивает её вместе со sleep)
```

`docker compose build` не пересоздаёт контейнеры, поэтому его смерть по таймауту
безопасна — но и незаметна: образы остаются старыми, ошибки в ленте нет. Отсюда
`echo EXIT=$?` в хвосте сеанса: он единственный отличает «собралось и поднялось»
от «канал оборвался».
Сборка трёх образов (сервер и оба исполнителя) занимает единицы минут — серверная
стадия тянет whisper.cpp из исходников. Отложенному сеансу остаётся `up -d`
**без** `--build`: он поднимает готовые образы сервера и обоих исполнителей
(`voicechat`, `runner-work`, `runner-personal`, плюс `caddy`) и не зависит от
того, что к тому моменту случилось с общим прод-каталогом. Цена — в образы
попадает дерево на момент `build`, а собственный коммит рана доедет до прода
следующим деплоем; для правок документации это и нужно.

Проверку здоровья отложенный сеанс делает **с хоста**, по опубликованному порту
`8787` (`http://127.0.0.1:8787/api/health`), — как `scripts/prod/deploy.sh`.
Изнутри серверного контейнера её сделать нечем: в образе нет ни `curl`, ни `wget`.
И результат всей второй фазы виден только в её логе — к моменту `up -d` ран уже
закрыт, в ленте этого нет. Лог поэтому именуется по задаче: боевой шаг берёт
`/tmp/voicechat-prod-rebuild-$TASK_KEY.log`. Общее имя раньше приводило к тому, что
две пересборки писали в один файл одновременно (два `EXIT=0` в одном логе) и
разобрать, какая из них что сделала, было нельзя.

## Версия и метаданные выпуска в интерфейсе

Контракт release metadata определён в `packages/shared/src/protocol.ts`: `GET
/api/health` вместе с nullable-версией и ISO-временем выпуска отдаёт короткий Git
SHA и связанную задачу как nullable-значения. Канонический номер выпуска приходит
в контейнер через `VC_RELEASE_VERSION`; это отдельная сущность от `AGENT_VERSION`
компаньон-агента. `VC_RELEASED_AT` позволяет передать точное время сборки. Если дата
не передана, сервер фиксирует время старта нового контейнера — для обычного
prod-деплоя это и есть время обновления.

Штатные `scripts/prod/deploy.sh` и `scripts/prod/rebuild-when-idle.sh` обновляют
Git-теги и ищут на собираемом `HEAD` строгий тег `vX.Y.Z`. Защищённая публикация
release-ветки передаёт её проверенную версию непосредственно в production deploy как
`VC_RELEASE_VERSION`; скрипты сохраняют это значение, поэтому опубликованная версия
не зависит от наличия Git-тега на выбранном SHA. До запуска настроенной команды
`ReleaseManager` обновляет `/usr/local/bin/voicechat-deploy` из уже проверенного
`scripts/prod/deploy.sh`, если production-команда использует этот launcher. Это
мигрирует даже установленную старую копию, которая после `git pull` продолжала
исполнять собственный код и безусловно заменяла переданную версию историческим
fallback `0.1.0`. Стабильный launcher явно материализует version/source при переходе
в content-addressed runtime, а первый проход `deploy.sh` сериализует их в служебные
позиционные аргументы для `setsid nohup`; detached-процесс восстанавливает значения
до deploy-lock, Git и Compose. Поэтому старый launcher, env или compose-default не
может подменить проверенную ReleaseManager версию. Для обычного production deploy
источником служит строгий тег текущего `HEAD`: найденный номер без `v` становится
`VC_RELEASE_VERSION`. Если ни переданного значения, ни тега нет, compose передаёт
пустую строку, а health честно возвращает `version: null` вместо технического номера.
Перед Docker-сборкой лог содержит version, 12-символьный commit и источник
версии (`release-manager`, `explicit`, `git-tag` или `none`). Эти же скрипты
экспортируют `VC_RELEASE_COMMIT` с 12-символьным SHA. Из темы
последнего коммита они извлекают первое обозначение задачи вида `chat-149` или
`chatai-149` (разделитель может быть пробелом) и нормализуют его до `chat-149` в
`VC_RELEASE_TASK`; если обозначения нет, значение остаётся пустым. Пустые
version/commit/task становятся `null` в ответе health.

Web-клиент получает данные во время выполнения через `app:ping`: версия не
запекается в Vite-бандл и не берётся из `package.json`. При известной версии футер
показывает `v<version>` в правом нижнем углу; нативная подсказка и доступное имя
включают локальные дату и время выпуска, а также имеющиеся коммит и задачу. Если
версия неизвестна, футер версии не рендерится; строка задачи также полностью
пропускается, когда определить её не удалось. Реализация находится в
`packages/ui/src/App.tsx`, граничные случаи закреплены в соседнем DOM-тесте.

## Прод мог обновиться и без рана: сначала проверь, потом пересобирай

Карточка «Пересборка прода» — след факта («в ране N пересборки не было»), а не
состояния прода. Если прод к моменту рана по карточке уже обновили — из чат-сессии
или внешним сеансом-финишером, — автоматика её не снимает: `ensureProdRebuildTask`
держит карточку открытой, пока её не увезут в done руками. Поэтому ран по ней
начинают с проверки, а не с пересборки: повторная сборка того же дерева ничего не
меняет, зато даёт лишний рестарт контейнера, а рестарт роняет очередные раны.

В образе нет `.git`, поэтому «какой коммит на проде» выясняют сравнением дерева
контейнера с ревизией:

```bash
# дешёвый маркер ревизии — любой файл, который правился в интересующем коммите
docker exec voiceaichat-voicechat-1 cat /app/docs/kb/ui.md > /tmp/prod-ui.md
git show <sha>:docs/kb/ui.md | cmp - /tmp/prod-ui.md

# серверный код целиком (сортировать обязательно, см. ниже)
docker exec voiceaichat-voicechat-1 sh -lc \
  'cd /app && find apps/server/src packages/shared/src scripts -type f -name "*.ts" | xargs sha256sum' | sort

# правка клиента: packages/ui/src в образе нет, есть только собранный бандл
docker exec voiceaichat-voicechat-1 grep -c keepActiveListed /app/apps/web/dist/assets/index-*.js
```

Имена свойств объектов минификатор сохраняет, так что грепом по
`apps/web/dist/assets/index-*.js` видно и клиентскую правку. Списки `sha256sum`
перед диффом надо сортировать: `find` в контейнере и на хосте выдаёт файлы в разном
порядке (разная локаль), и без `sort` дифф показывает расхождение там, где его нет.
Дата сборки образа (`docker images voicechat`) отвечает только «когда», но не «что»:
прод-каталог — заодно рабочая копия чат-сессий, поэтому образ мог быть собран и из
грязного дерева.

Полное сравнение `sha256sum` нужно именно при подозрении на грязное дерево. В
обычном случае отставание считают лестницей от дешёвого к дорогому: `git status` и
`git rev-list --count HEAD..origin/main` в `$PROD` (сколько коммитов не
доехало и нет ли встречных), затем сверка времени создания образов с временем
коммита `HEAD` — если образы моложе коммита на минуты, они собраны именно с этой
вершины, — и только потом один файл-маркер из ожидаемого коммита (`docker exec …
ls /app/scripts/ci-usage-report.mjs`). Лестницы хватает и на главный вопрос
карточки: в ней обычно перечислен десяток задач, а отстают одна-две — те, чьи
коммиты лежат в `HEAD..origin/main`, остальные уже предки прод-вершины.

Третий способ пересобрать, помимо боевого шага и двухфазного из рана, — вынести
пересборку из рана вообще: внешний сеанс (`setsid`) опрашивает раны проекта, ждёт,
пока не останется ни одного `queued|running|awaiting_input`, и только тогда делает
`pull --ff-only → docker compose build → up -d` с секундной паузой. Задержку угадывать
не нужно, и пачка ранов не рвётся на середине; цена — результат виден только в логе
сеанса, в ленте рана его нет.

**Кастомный домен публикаций Make (roadmap-4 п.33, ⏸).** Публикации живут на `/p/<token>/` и `/s/<slug>/` того же хоста. Свой домен на проект требует wildcard-DNS (`*.make.<домен>` → прод) и TLS-сертификата на wildcard в Caddy (`tls` с DNS-челленджем) плюс маршрут, который по `Host` подставляет slug; ни DNS-зоны, ни DNS-провайдера в окружении нет, поэтому пункт отложен. Когда появятся — точка входа: `servePublic` в `apps/server/src/routes/make.ts` (разрешение slug → token через `.published/slug-<slug>.json`).

**Почта для регистрации.** `docker-compose.yml` пробрасывает их из `.env` рядом с
compose — то есть из `$PROD` (`VC_REPO_DIR`, см. выше), а **не** из корня данных. Прод-контейнеру нужны `VC_SMTP_URL=smtps://user:pass@smtp.example.com:465` (или `smtp://…:587` со STARTTLS), `VC_MAIL_FROM='ChatAI <no-reply@example.com>'`, `VC_PUBLIC_URL=https://…` — задаются в `docker-compose`/env прод-сервера; без них регистрация работает, но ссылки подтверждения видны только в логе сервера (`docker compose logs server | grep 'mail ('`).

## Почта на проде (настроено 29.08.2026)

Прод-`.env` (`$PROD/.env`, то есть `VC_REPO_DIR`) получил три переменные:
`VC_SMTP_URL=smtps://<логин>:<пароль-приложения>@smtp.yandex.ru:465`,
`VC_MAIL_FROM=ChatAI <логин>`, `VC_PUBLIC_URL=https://89.125.68.35`. Рядом
лежит резервная копия `.env.bak-<дата>`. **Переменные начинают действовать только
после пересоздания контейнера** — то есть на ближайшем `voicechat-deploy`; до
этого письма по-прежнему уходят в лог.

Публичный origin отдаёт Caddy (`voiceaichat-caddy-1`) — `https://89.125.68.35`.
`VC_PUBLIC_URL` обязан точно совпадать с актуальным production origin: сервер
использует его при формировании внешних ссылок, включая
`https://89.125.68.35/#/verify/<token>`. Если переменная не задана, `baseUrl(req)`
может собрать адрес из `X-Forwarded-Proto`/`X-Forwarded-Host`, но явное значение
не даёт ссылкам зависеть от конфигурации прокси.

### Что проверено живьём про Яндекс

- **Обычный пароль аккаунта SMTP не принимает:** `AUTH` отвечает
  `535 5.7.8 Invalid user or password`. Нужен **пароль приложения**
  (`id.yandex.ru → Безопасность → Пароли приложений → Почта`) — 16 строчных букв.
  Проверять пару логин/пароль надо локально (`smtplib.SMTP_SSL` + `login` или наш
  `createMailer`), а не правкой прод-`.env`: отказ виден за секунду и не требует
  перезапуска контейнера.
- **Наш собственный SMTP-клиент проходит реальный путь до Яндекса** — письмо
  доставлено через `createMailer` → `sendSmtp` (ветка `secure` для порта 465).
- **Сквозной путь приложения тоже проверен:** временный сервер на своём порту с
  этими переменными отдал `POST /api/projects/:id/invitations` → `mailed: true`,
  письмо ушло на реальный адрес.
- **Экранировать `@` в логине не нужно.** `new URL('smtps://user@ya.ru:pw@host')`
  берёт делимитером **последний** `@`, поэтому и `sislex@ya.ru`, и
  `sislex%40ya.ru` разбираются одинаково (`mailer.ts` затем зовёт
  `decodeURIComponent`). `VC_MAIL_FROM` обязан совпадать с адресом авторизации,
  иначе Яндекс отклонит `MAIL FROM`.

### Диагностика сетевого таймаута SMTP (03.09.2026)

Безопасная проверка из production-контейнера показала DNS-ответы IPv4 и IPv6:
IPv6 завершается `ENETUNREACH`, а IPv4 к `smtp.yandex.ru:465` — таймаутом до TLS
handshake. Тот же IPv4-таймаут воспроизводится с самого хоста, поэтому причина не
в Docker bridge/NAT, SMTP-клиенте, TLS или реквизитах. Локальный firewall разрешает
исходящий трафик; подключения к SMTP других провайдеров на 465 и к Яндексу на 587
также таймаутятся, тогда как обычный HTTPS к Яндексу доступен. Совокупность этих
признаков подтверждает фильтрацию почтовых портов выше уровня production-хоста.
До снятия внешнего egress-фильтра проверка AUTH и доставки с этого хоста
невозможна; секретные URL и реквизиты для такой диагностики выводить не нужно.

### Ручной `voicechat-deploy` стирает версию в health

`version` в `/api/health` берётся из `VC_RELEASE_VERSION`, которую передаёт
Release Center. Запуск скрипта руками без неё проходит успешно, но прод начинает
отдавать `version: null` — метаданные релиза в логе при этом честно пишутся как
`version=нет … source=none`. Поэтому ручной проход задавай явно:

```bash
VC_RELEASE_VERSION=<текущая версия> VC_RELEASE_VERSION_SOURCE=explicit voicechat-deploy
```

Версию перед этим смотри в health: перевыкладывается **тот же** коммит, так что
метка остаётся честной. Проверено 29.08.2026 — первый проход без переменной дал
`version: null`, повторный с ней вернул `0.1.184`.

## Браузерный раннер в docker compose

Сервис `browser-runner` — изолированный Chromium для Playwright Reader и этапа
автотестов. До 29.08.2026 его в `docker-compose.yml` не было вовсе: на проде
браузера не существовало, сервер отвечал 501, а панель показывала «изолированный
Chromium недоступен».

Что важно в его описании:

- **Своя база образа.** Цель `browser-runner-runtime` собирается из
  `mcr.microsoft.com/playwright:vX.Y.Z-noble`, а не из общего `runtime-base`:
  Chromium тянет десятки системных библиотек, и класть их в общий образ ради
  одного сервиса значит раздуть все остальные.
- **Пользователь берётся готовый — `pwuser` из образа Playwright.** Свой заводить
  нельзя: образ основан на Ubuntu 24.04, где uid 1000 занят штатным `ubuntu`
  (`ubuntu:x:1000`, `pwuser:x:1001`).
- **Общий `docker-entrypoint.sh` этому образу не подходит.** Он сбрасывает
  привилегии через `gosu`, а `gosu` ставится в `runtime-base` пакетом apt — в
  образе Playwright его нет. Поэтому здесь `USER pwuser` и обычный `CMD`, а
  `chown /data` делается в сборке **до** `VOLUME`: именованный том при первом
  создании наследует владельца каталога из образа.
- **Версия пакета `playwright` закреплена точно и равна тегу образа.** Это не
  пожелание, а условие работоспособности: образ приносит сборку браузера под
  свою версию, и пакет с диапазоном разъезжается — ищет
  `chromium_headless_shell-1234`, когда в образе лежит `-1181`. Держит
  `apps/browser-runner/src/imageVersion.test.ts`.
- **`shm_size: 1gb`.** Chromium падает при нехватке разделяемой памяти, а
  дефолт Docker — 64 МБ. Это самая частая причина «браузер стартовал и умер».
- **Порт 8792**, наружу не публикуется: ходит к нему только сервер по внутренней
  сети compose. У `stt-runner` и `tts-runner` внутри свои 8791 — конфликта нет,
  у каждого контейнера своё пространство портов.
- **Сервер знает адрес** через `VC_BROWSER_RUNNER_URL: http://browser-runner:8792`
  и `VC_BROWSER_RUNNER_TOKEN`; без них `config.ts` оставляет раннер
  ненастроенным и роуты `/api/browser/*` отвечают 501.
- Health — `GET /v1/health` **с bearer-токеном**: у раннера все `/v1/*` закрыты
  авторизацией, поэтому healthcheck передаёт токен, как у automation-runner.
  Проверка настоящая: ищет исполняемый файл браузера и один раз запускает его,
  успех кэширует, при сбое отвечает 503 с причиной. Раньше health возвращал
  литералы `present: true, launch.ok: true` — контейнер с неработающим Chromium
  считался здоровым.

### Доверие сертификату собственного стенда

Наш https стоит за Caddy с его **внутренним** центром сертификации: цепочка
корректна и `SAN` совпадает (`IP Address:89.125.68.35`), но корень
`CN=Caddy Local Authority - … Root` не входит ни в один публичный список
доверия. Отсюда `unable to get local issuer certificate` (curl 60) и
`net::ERR_CERT_AUTHORITY_INVALID` в Chromium: **изолированный Chromium не мог
открыть собственный сайт проекта**.

Чинится доверием, а не отключением проверки. `ignoreHTTPSErrors` у Playwright
контекстный — он выключил бы проверку сразу для всех адресов, и раннер перестал
бы отличать наш стенд от подменённого узла.

- **Передаётся значением: `VC_BROWSER_EXTRA_CA_B64`** — корневой сертификат в
  base64. Монтировать том Caddy нельзя: весь его каталог `pki` имеет режим
  `drwx------` под root, потому что **рядом с корнем лежит приватный ключ
  центра**. Раннер работает под `pwuser` и файл не прочитает (`EACCES`), а
  сделать каталог доступным значило бы отдать контейнеру ключ CA. Сам корневой
  сертификат публичен, и держать его в `.env` безопасно.
- base64, а не PEM как есть: многострочное значение с переводами строк ломается
  и в `.env`, и в подстановке compose, и в шелле — по-разному на каждом этапе.
  Есть ещё `VC_BROWSER_EXTRA_CA_PEM` и `VC_BROWSER_EXTRA_CA_FILE` для стендов,
  где файл действительно читаем.
- Значение для прода снимается так:
  `docker exec voiceaichat-caddy-1 cat /data/caddy/pki/authorities/local/root.crt | base64 -w0`
- Chromium на Linux берёт пользовательские корни из базы NSS
  (`$HOME/.pki/nssdb`), поэтому в образе стоит `libnss3-tools`, а раннер при
  старте добавляет сертификат через `certutil -A -t "C,,"`.
- Сертификат читается **один раз при старте**, поэтому после правки `.env`
  нужен `docker compose up -d browser-runner`. Пустое значение — не ошибка:
  раннер пишет предупреждение и поднимается без дополнительного доверия.
- Корень Caddy живёт до 2036 года, но при смене машины или сбросе тома `vc-caddy`
  он выпускается заново — значение в `.env` придётся снять заново.
- Проверено обеими сторонами: с CA переход на `https://89.125.68.35/` даёт
  страницу с заголовком «Голос·Чат», без CA — `ERR_CERT_AUTHORITY_INVALID`, а
  внешние сайты с публичными CA открываются в обоих случаях. То есть проверка
  сертификатов осталась включённой.

Node-сторона (сервер) в этот запрет не упирается: к стенду он ходит не напрямую,
а туннелем агента. Если понадобится — у Node для этого есть `NODE_EXTRA_CA_CERTS`.

### Собственный сайт: контейнер не достаёт до публичного IP своего хоста

Сертификатом дело не кончилось. После доверия CA переход на `https://89.125.68.35/`
стал давать **таймаут**, и замер из контейнера объяснил почему:

| цель из контейнера | результат |
|---|---|
| `89.125.68.35:443` и `:8787` | timeout |
| `caddy:443`, `voicechat:8787` (имена сервисов) | ok |
| `example.com:443` | ok |

С самого хоста сайт отвечает `200`. Причина — ufw: в нём разрешены только 3001,
3002 и OpenSSH. Снаружи сайт работает потому, что Docker публикует порты своими
правилами **в обход** ufw, а трафик «контейнер → IP собственного хоста» идёт
через `INPUT`, где ufw его и режет.

Правило firewall мы не меняем — это системная настройка хоста. Вместо этого у
раннера есть **алиасы адресов**: `VC_BROWSER_HOST_ALIASES` со списком пар
`внешний host:port=внутренний host:port`, например
`89.125.68.35:8787=voicechat:8787,89.125.68.35:443=caddy:443`.

- Подмена происходит **после** проверки исходного адреса, поэтому SSRF-гейт на
  месте: во внутреннюю сеть пускает оператор списком, а не пользователь адресом.
- Цели алиасов — единственные внутренние адреса, которым раннер доверяет; они
  же доступны и напрямую (это то же самое место, названное оператором).
- Проверено: `10.0.0.1`, `127.0.0.1:8787` и имя чужого контейнера по-прежнему
  отклоняются (`private network targets are blocked` / `ERR_BLOCKED_BY_CLIENT`).

**Публичный адрес в Caddyfile — переменная `VC_PUBLIC_HOST`, а не литерал.**
Адрес уже менялся при переезде (45.135.182.251 → 89.125.68.35), и файл остался
со старым IP; прод работал только потому, что действующая конфигурация была
загружена **мимо файла** (контейнер Caddy был смонтирован с
`/root/voicechat-new-Caddyfile`, файла вне репозитория, и с тех пор не
пересоздавался). Первое же пересоздание подняло бы Caddy со старым адресом и
https перестал бы отвечать. Держит `apps/server/src/infra.caddy.test.ts`.

**На проде был `COMPOSE_FILE`-override, и он всё это время побеждал репозиторий.**
В прод-`.env` строка `COMPOSE_FILE=…/docker-compose.yml:/root/voicechat-new-compose.override.yml`
подменяла один том — Caddyfile на `/root/voicechat-new-Caddyfile`. Так когда-то
обошли смену IP, не трогая репозиторий. Следствие: правки Caddyfile в репозитории
**не доезжали** до прода вовсе, а расхождение никак себя не проявляло. После
параметризации хоста override убран из `COMPOSE_FILE` (файлы оставлены рядом как
резерв, `.env` сохранён в `.env.bak-compose-<дата>`), и Caddy снова читает
конфигурацию из репозитория. Проверяя расхождение конфигурации и поведения,
смотри `COMPOSE_FILE`: `docker compose` молча склеивает файлы.

**Внутреннее имя `https://caddy` со своим сертификатом** — то, что делает наш
https открываемым из браузерного раннера. Дальше — почему без него не работало.

**Для https алиас сам по себе не работает.** Подмена меняет и SNI: Caddy получал имя
`caddy`, которого не знал, и отвечал `ERR_SSL_PROTOCOL_ERROR`. Лечится не
firewall-ом, а тем, что это имя у Caddy теперь **есть**: блок `https://caddy` с
`tls internal` выдаёт сертификат того же локального CA, которому раннер уже
доверяет. После этого алиас `89.125.68.35:443=caddy:443` работает.

Проверено на проде 0.1.192: `http://89.125.68.35:8787/`, `/#/login` и
`/api/health` открываются, текст читается селектором, снимок снимается.

### Грабли, на которых встал релиз 0.1.189

`docker build --check` **не выполняет шаги** — он разбирает синтаксис. Цель,
собранная поверх чужого базового образа, с ним проходит проверку и падает на
проде. У этой цели так вскрылись три дефекта подряд, и каждый следующий был
виден только после исправления предыдущего:

1. `useradd -m -u 1000 node` → `useradd: UID 1000 is not unique` — сборка;
2. `gosu` из общего entrypoint отсутствует в образе — упал бы старт контейнера;
3. `playwright: ^1.54.2` установился как 1.62.1 → «Executable doesn't exist» —
   упала бы первая сессия, причём health рапортовал «ок».

Вывод для новых целей: недостаточно `--check`. Нужны настоящая сборка, запуск
контейнера и один осмысленный запрос к сервису.

Первая сборка тянет образ Playwright (~2 ГБ) — на проде стоит следить за местом:
инцидент с переполнением диска уже был (на 29.08.2026 свободно 8.4 ГБ из 59).

## Independent tool source releases

The tool repositories provide `npm ci`, `npm run gate`, and a Dockerfile whose
final `api` target runs the standalone API. `--target frontend` serves the
versioned UI manifest and immutable assets. Supply `APPLICATION_VERSION` and
`APPLICATION_COMMIT` from that repository's release, not from the host release.
All dependency endpoints and secrets remain runtime configuration. API health
works before Core is reachable; authenticated operations still require Core and,
for browser actions, the configured Reader/browser runner services.

The host's `application-build.mjs` includes only reachable locked vendor archives
in isolated build contexts. It rejects paths outside `vendor/`, directory archives
and symlinks. The host frontend builder preserves each adapter's upstream version
and commit rather than relabeling panels with the Chat release. Production changes
continue through the installed `voicechat-deploy` command and preserve operator
Compose overrides, especially external LLM relays.

`deploy/tools.lock.json` records the exact source revisions consumed by the host.
To build from those repositories, append `deploy/compose.tools.yml` to the
existing `COMPOSE_FILE` chain and set `SISLEXA_MAKE_SOURCE`,
`SISLEXA_PLAYWRIGHT_READER_SOURCE` and `SISLEXA_WEB_READER_SOURCE` to clean source
snapshots at those revisions. This override starts the standalone Reader and
three frontend servers, while preserving API service names, Make data mounts,
browser runner settings and the existing LLM relay override. It requires Compose
support for `!reset` to clear the optional Reader profile. UI asset volumes retain
hashed assets for already open tabs. The standard deploy command remains the
only production container replacement entrypoint.

At the first cutover, seed each frontend asset volume from the previous core
image's `packages/<tool>-app/dist`, excluding `manifest.json`. Preserve identical
hashed files and reject a same-name/different-content collision; make the cache
writable by the image's Node user. This retains assets for open tabs while the
active manifest continues to come from the new image. Later releases reuse the
same asset volume normally. Verify old entry URLs as well as new manifest SRI.

## Managed component installation

`SISLEXA_COMPONENT_CONFIG` enables release-owned dependency requirements and
provider-issued component grants. Core's contract is
`apps/server/component-contract.json`; each independently released tool owns its
corresponding contract. `deploy/components/*.example.json` contains installation
settings. Exact implementation/API ranges and required scopes live in release
contracts; installation JSON can select origins and credentials but cannot lower
these requirements. Configured Core tool dependencies select remote mode and
replace their legacy endpoint variables. A remote tool missing from managed config
is a startup error. No configuration preserves the legacy migration mode.

Initialize a **new** private directory from the pinned host checkout:

```sh
npm run components:init -- --directory /private/sislexa-components \
  --environment development --core-url http://127.0.0.1:8799 \
  --make-url http://127.0.0.1:8788 \
  --playwright-reader-url http://127.0.0.1:8797 \
  --web-reader-url http://127.0.0.1:8795
```

For containers, pass `--container true`; generated runtime paths then use
`/run/sislexa`. Set `SISLEXA_COMPONENTS_DIR` to the private host directory and append
`deploy/compose.components.yml` **after** the existing operator and tool overrides.
Run provider token commands as the service OS user (for Core Docker exec, pass
`--user 1000`; its root entrypoint otherwise makes exec default to root).
Assign the generated files to each service's OS user before starting containers
(the current images use UID 1000). Registry directories and outgoing token files
are private (0700/0600). Each service mounts only its own registry, config and
read-only outgoing directory. These mounts are separate from shared workshop data.
Do not remove existing production overrides or rerun the production installer.

Initialization now creates fifteen distinct credentials across nine providers,
including Identity verification for Billing and Billing reserve/execute grants for
Core. Each consumer receives only its declared provider scopes. Existing installation directories are rejected. The default credential
lifetime is 30 days (`--ttl` is bounded by each provider's configured policy).
Track the returned expiry metadata and rotate before expiry. The CLI never prints
secrets. Provider-local `components:token`/tool `token` commands issue, list and
revoke credentials; transfer a newly issued private file to the consumer, replace
its outgoing file atomically, then revoke the old token ID. Grant-policy edits
require a provider restart; revocation takes effect immediately for RPC requests.

Billing 1.0.0 is an independently pinned service in `deploy/tools.lock.json` and
the application catalog. Append `deploy/compose.billing.yml` after the Identity
override, set the immutable Billing source/commit variables, and prepare its
private provider/outgoing directories. Identity must be at least 1.2.0 to supply
stable user IDs. The default internal port is 8800. `vc-billing-data` contains the
financial ledger and must be backed up consistently with reconciliation evidence;
it is not disposable cache. Existing installations must add the two new grants
without replacing existing registries or session secrets. Published component
versions alone do not prove that production has been upgraded; the production
verification sections record the actual deployment baseline.

Analytics 1.2.0 is a separate service on port 8801. Append
`deploy/compose.analytics.yml` after Identity and Billing. Its installation grants
Core `analytics.activity` and `analytics.report`, consumes `identity.verify`, and
consumes `billing.report`; every grant uses a distinct provider-owned token.
`vc-analytics-data` stores replay keys and activity intervals and must be included
in retention-aware backups. The default image is pinned to the owner commit, and
Core's managed dependency requires Analytics 1.2.x so the browser transport and
server routes share the same owner contract.

The canonical deploy script supplies the full source SHA, release version and
release-owned API/data versions to the Core Docker build. Bare Node development
must likewise provide truthful `VC_APPLICATION_VERSION`,
`VC_APPLICATION_API_VERSION`, `VC_APPLICATION_DATA_VERSION` and the full
`VC_APPLICATION_COMMIT` when another component depends on it; unidentified builds
are rejected. Independently built tool images carry their own metadata.

`GET /v1/component` is static metadata. Authenticated
`POST /v1/component/authorize` verifies requested scopes and returns the consumer,
provider, environment and expiry. Neither endpoint recursively checks dependencies,
so Core/Make can start in either order. `GET /v1/ready` returns 503 for incompatible,
unavailable or unauthorized dependencies, identifying only safe application IDs.
Outgoing RPC and public proxy requests verify dependency metadata and grants;
RPC supplies that provider's credential, while public proxies preserve user
credentials. Successful compatibility checks cache for up to five seconds.
Provider RPC still checks current token revocation, expiry and exact scopes on
every request. The HTTP client never follows RPC redirects or forwards a service
credential to another origin.

Browser Runner and external LLM runner retain their existing credential mechanisms.
Core's current sample managed config permits legacy credentials only for identity
forwarding; Image Studio joins the managed grants during the Voice/Image extraction.
The shared legacy token cannot call migrated tool RPC and is removed from managed
tool containers by the component override. Remote legacy Kanban/administration need explicit
migration settings before enabling managed mode. Component grants are not user
identity delegation or authoritative billing. Existing shared data volumes also
remain a separate, broader trust boundary.

The canonical `voicechat-deploy` success condition also runs
`scripts/component-readiness.mjs` inside Core after basic health succeeds. Managed
installations require readiness of Core and each configured tool, covering both
directions of their grants; a static healthy process cannot mask an expired or
misconfigured dependency. Legacy installations retain their basic health check.

The root Docker context excludes real `.env`/`.env.*` files and local test/build
output; public `.env.example`/`.env.sample` templates remain available. A real
Docker context-export check verified the exclusion. Production installation
credentials must enter through runtime environment or private mounts, never
through `COPY . .` into an image. Core does not load the checkout `.env` itself;
Compose supplies its runtime environment.

On the 8 GB production host, simultaneous rebuilds exhausted memory and swap during
0.1.312 preparation. The build client was cancelled before container replacement;
the existing 0.1.311 Core recovered after automatic restarts. Keep
`export COMPOSE_PARALLEL_LIMIT=1` and `export COMPOSE_BAKE=false` in
`/etc/voicechat/production.env`, with matching Compose settings in the checkout
`.env`. The installed Bake path combined all targets despite `--parallel 1`;
prepare images with one `docker compose --parallel 1 build <service>` call per
service in a sequential loop, using the same release/application metadata,
then replace containers only through `voicechat-deploy`. Monitor memory and free
disk during the build; prune only unused builder cache when needed. Do not remove
application volumes, backups or rollback images to make room. Refresh an old
installed deploy script from the verified release checkout, as ReleaseManager
does, without rerunning the production installer or overwriting operator env.

For 0.1.312, remaining runner images reused `/app` from the verified Core image
(`sislexa-prebuilt-core-app:0.1.312`) after the host ran out of space while making
another full application copy. A temporary Dockerfile replaced only the build
stage with that image; runner runtime stages remained the release Dockerfile's
stages. Preserve the source SHA and image ID when reusing this artifact. This is
an operational build optimization, not a source-code change.

When cache eviction is required after preparation, create a release-specific
Compose override that removes each prepared service's `build` key with
`!reset null`, selects a local immutable image tag and sets `pull_policy: never`.
Pass it only in the environment of the authorized `voicechat-deploy` invocation;
do not append it permanently to the operator's default override chain, which
must remain able to build the next release. The deploy still performs volume
validation, release metadata setup, container replacement and component readiness
checks. Record the resulting image IDs with the release backup.

Production 0.1.313 (`451cf46c9acd759bcf1aa3ffb54745ea04f70550`) completed through
`voicechat-deploy` at 2026-09-20 03:25:48 UTC. It pins Make 1.1.1 and both Readers
at 1.1.0; all three managed tool containers have empty `VC_INTERNAL_TOKEN`.
The Core image was updated from the verified 0.1.312 image with the new release
source and pinned Make package, followed by frontend builds and native SQLite
loading checks. The resulting image excludes `.env` and reports the full release
SHA. The temporary image-only deployment override is
`/etc/voicechat/prebuilt-0.1.313.yml`; it is not in the permanent Compose chain.
Image IDs and the pre-release database/configuration backup are under
`/var/backups/voicechat/sislexa-managed-final-20260920T030816Z`.

Private installation state remains `/etc/sislexa/components-0312`; this directory
names the initial installation, not the currently deployed release. The seven
initial credentials must be rotated before the earliest expiry,
2026-10-20 02:00:52 UTC. Rotation is currently an operator CLI procedure, not an
automatic timer. Backup verification checked all seven credential files against
the live files and integrity-checked the four initial provider registries.

### Voice and Image Studio release inputs

`deploy/compose.voice-image.yml` adds independently built STT/TTS, Image Studio API
and Image Studio frontend to the existing tool Compose chain. Pin source directories
with SISLEXA_VOICE_SOURCE and SISLEXA_IMAGE_STUDIO_SOURCE using tools.lock.json.
Voice targets are stt/tts; Image Studio targets are api/frontend. Preserve existing
speech model/voice volumes and gallery data. The new frontend stores retained assets
in image-studio-ui-assets, with host manifest/SRI verification unchanged.

Fresh components:init installations now create eleven directional grants for Core,
Make, both Readers, Image Studio, STT and TTS. Existing installations must explicitly
migrate their configs and issue the additional grants before applying the extended
compose.components.yml; do not overwrite an existing provider registry. Image Studio
uses its own image-studio.service credential, and a separate Core-issued grant for
identity.verify/image-studio.core/image-studio.generate. Default installation examples
remove Image Studio's legacy Core scopes. Speech requires read/run/manage permissions.

Component runtime 1.0.1 adds verified credentials for non-fetch transports and an
explicit per-dependency timeout. Image generation and its public proxy use the image
operation timeout, retaining cancellation. Earlier tool source distributions receive
compatible 1.x peer ranges while standalone lockfiles keep their tested runtime.
These distribution-only patches do not require replacing otherwise compatible running
API services. Production deployment remains exclusively through voicechat-deploy.


### Production 0.1.314 verification

Production 0.1.314 (`75633d7ea5d87db42563d425a62fc1d807c216e3`) completed through
installed `voicechat-deploy` at 2026-09-20 06:24:35 UTC. Voice 1.0.0 owns STT/TTS
and the portable browser audio library; Image Studio API/UI runs 1.0.1. Their full
source commits remain pinned in `deploy/tools.lock.json`. Core retains compatibility
adapters. Chat orchestration and authoritative identity remain Core responsibilities.

The operator Compose chain adds `deploy/compose.voice-image.yml` immediately before
`deploy/compose.components.yml`; existing tool and external LLM overrides remain.
Source snapshots are `/opt/sislexa/voice-c308f29f70a9` and
`/opt/sislexa/image-studio-4ca6e99ce0c2`. The active private installation is
`/etc/voicechat/components-0.1.314`, with seven provider registries and eleven distinct
outgoing credentials. Rotate them before 2026-10-20 05:45:10 UTC. Rotation still uses
the operator CLI; no automatic renewal is implied. Old installation state is retained
for rollback. These grants do not replace user authorization or implement new billing.

Database/configuration backups and the thirteen pinned image IDs are under
`/var/backups/voicechat/sislexa-voice-image-20260920T055525Z`. The custom-format PostgreSQL
dump was checked with `pg_restore --list`; all provider registries passed SQLite
integrity checks. The temporary image-only overlay is
`/etc/voicechat/prebuilt-0.1.314.yml`, outside the permanent Compose chain. Core reuses
the verified 0.1.313 image, installs the locked source distributions and rebuilds the
frontends. Native SQLite loading and the exclusion of `.env` were verified.

When invoking a prepared image-only deployment, export **VC_REPO_DIR** as well as
COMPOSE_FILE. Sourcing `production.env` alone does not export every assignment. If
VC_REPO_DIR is missing from the child environment, `voicechat-deploy` reloads the file
and replaces the temporary COMPOSE_FILE override, unexpectedly rebuilding services.
During this rollout that first attempt was stopped before container replacement;
only unused builder cache was removed. The successful invocation exported the loaded
operator environment, appended the temporary overlay, and verified that the exact
resulting Compose configuration had zero build targets and all thirteen expected
image IDs before starting the installed deploy command. Retain this preflight.

Live checks verified readiness for all seven components, full source provenance,
eleven directional grants, 401/403 rejection, immediate revocation, user-session
separation, UI manifest/SRI integrity, and retained Image Studio 0.1.312 assets.
Two temporary accounts verified gallery upload/read/delete, cross-user 404 responses
and cookie CSRF rejection; both accounts and their sessions were removed. Piper
`ru_RU-ruslan-medium` produced a 170772-byte WAV which Whisper `large-v3-turbo`
transcribed exactly. HTTPS certificate verification, the browser login screen with
zero page errors, Web Recorder and a bounded Codex completion also passed.


### Independent Identity deployment

`deploy/compose.identity.yml` adds Identity 1.0.0 from its pinned independent
checkout. Append it to the existing operator Compose chain; preserve the external
LLM relay and reader recovery overlays. Set `SISLEXA_IDENTITY_SOURCE`,
`SISLEXA_IDENTITY_COMMIT`, and the existing PostgreSQL `VC_DB_URL` in the effective
Compose environment. The eight-provider installation has thirteen directional
grants. Identity consumes `identity.core`; Core consumes verify/session/store/event
scopes from Identity. Copy the current `session.secret` into the private Identity
mount without changing its contents, readable only by the runtime user. Preserve
existing user rows and hashes; this release shares the existing database.

Core proxies `/login/`, `/account/` and session requests to Identity. Public request
authentication and WebSocket commands are verified through the component dependency;
Identity failure denies protected requests. A rollout must verify existing-session
continuity, login, session revocation, account assets and provider readiness before
it is considered complete. Use the installed `voicechat-deploy` with the complete
operator environment and verify that any prebuilt overlay removes all build targets.

The Identity catalog entry produces a separate Release Center build context. Its
adapter declares the test/type dependencies used by the upstream server check;
`apps/identity/container.json` supplies native SQLite build tools. The pinned source
archive includes the separately built login/account assets, so runtime startup
does not require the Core UI source.


### Production 0.1.315 verification

Production 0.1.315 (`79d54f397a3e50ae1b459c2b6dd4cea262cd139b`) completed through
installed `voicechat-deploy` at 2026-09-20 11:03:22 UTC. Identity 1.0.0
(`85ee08cdc7e3004a15417a1f86781ec68a0df47b`) runs independently from its published
repository. All fourteen application containers were running; all configured
container healthchecks passed, as did Core health and all eight provider readiness
checks. The installation has thirteen active provider-specific grants.

The first readiness attempt caught a configuration error: the prepared Core
Web Reader dependency used port 8790 instead of the retained production port 8795.
The address was corrected, all existing dependency URLs were compared with the
previous installation, and the canonical deployer recreated Core using a config
revision label in the invocation-only prebuilt overlay. Future installation
preflights must preserve actual dependency URLs, not infer ports from application
names. The final deploy succeeded; readiness was not bypassed.

Private configuration and image rollback references remain under
`/var/backups/voicechat/sislexa-identity-20260920T085145Z`. A production database
backup was restored locally and Identity initialization preserved every user and
session row. A refreshed dump was captured at 10:38 UTC and its archive directory
validated. Component configuration is `/etc/voicechat/components-0.1.315`;
the exact prior session signing secret and PostgreSQL connection were retained.
The invocation-only `/etc/voicechat/prebuilt-0.1.315.yml` selected fourteen verified
images with zero build targets, while preserving operator networks, mounts,
external LLM settings and reader recovery configuration.

Live checks passed existing-session continuity, existing-password login, Core and
Identity agreement, cookie CSRF, HTTP/WebSocket logout revocation, and rejection
of a component grant as a user session. Mobile HTTPS login, account aggregation
and device-session UI passed without page errors. Provider metadata, scopes,
revocation, versioned frontend integrity and every tool-to-Core callback were
verified. Image Studio upload/read/delete and cross-user isolation passed;
retained Image Studio 0.1.312 assets and Web Recorder remained available. Piper
produced a valid WAV and Whisper large-v3-turbo recognized the fixture phrase;
the external Codex relay completed a bounded response. Temporary user accounts,
sessions and credential files were removed after verification.


### Local Image Studio using production Core

The local API can use production Core/Identity through a loopback-only SSH
forward without changing production routing. This workstation's private launcher
is `~/.config/sislexa/image-studio-production/start.sh`: API port 18896, tunnel
port 18787, local gallery data below that private configuration directory. The
existing process on 8796 was retained. The provider grant is a separate seven-day
Core token for consumer `image-studio`, with only identity verification, Image
Studio Core RPC and generation scopes; the active production service token was
not copied or replaced. `grant.json` records expiry and revocation ID privately.
The configuration environment is `production` because that is the remote authority.
The private `tunnel.sh` supervises SSH and reconnects after sleep or network loss.
A live API process alone does not imply that its remote dependency is reachable;
check `/v1/ready`. Forced termination of the owned SSH child recovered automatically
and restored Core readiness. The launcher selects the released 1.0.5 source checkout.

`/v1/ready` returned 200 with Core ready. Anonymous gallery access returned 401,
a valid production session reached the inaccessible-conversation 404, and a
foreign tenant hint returned 403. Root `/` returning 404 is expected for this
API-only process. API clients still supply the production user's credential.
Gallery files stay local, while conversation metadata and model execution use
production. See the Image Studio repository's operations guide for generic setup.

The separate browser entry is http://127.0.0.1:18897/, started by private
`start-ui.sh` in the same configuration directory. Its source is owned by
`sislex/image-studio`, `apps/studio-web`, currently in the isolated local
`sislexa-image-studio-web` checkout. This application renders only Image Studio
and gallery controls, bundles its own runtime, and uses Identity's `/login/`
page. Identity's `/account/` completion redirect returns to the studio. The local
gateway serves its own assets, forwards image requests to 18896 and session /
gallery-metadata requests to 18787, and rejects unrelated API/internal/WS routes.
No Core chat shell is loaded. Cookies and CSRF retain user attribution; component
credentials remain in the API configuration. A production Identity sign-in, local
upload/read, logout and mobile layout were verified in a real browser. No paid
image generation was run. `npm run studio` builds/serves the standalone UI;
`npm run dev:studio` enables hot reload with explicit dependency origins.

### Production 0.1.316 verification

Production 0.1.316 (`9cb7e7ac56ea0043d14df7627d697f29b374552f`) completed through
installed `voicechat-deploy` at 2026-09-20 13:46:21 UTC. Identity 1.1.1
(`b1fddb949e02fc90fc479f559772136a1cdfd47b`) owns the personal tenant and tariff
migration. Both canonical Core gates passed with all 807 browser checks each;
independent application gates also passed before publication. Exact component
versions and source commits are retained in `deploy/tools.lock.json`.

The existing `/etc/voicechat/components-0.1.315` installation and thirteen grants
remain active. Dependency URLs, including Web Reader port 8795, PostgreSQL settings
and the session signing secret were preserved. Immutable sources are under
`/opt/sislexa/tenant-releases/<repository>/<commit>`. The invocation-only
`/etc/voicechat/prebuilt-0.1.316.yml` selected fourteen verified images with zero
build targets. Core image `sislexa-prebuilt-core-app:0.1.316` has image ID
`sha256:4515d1a8bc5b7415f64369e667c50b28e3eabdd7a4498fb1d83623af50c6d1a7`;
its native SQLite loading, source provenance and rebuilt frontend integrity were
checked before deployment. The deploy command launches work in the background;
completion was verified from the successful terminal entry in the deploy log,
not merely the launcher exit code.

Private configuration and image rollback references are under
`/var/backups/voicechat/sislexa-identity-20260920T123042Z`. The fresh 382035955-byte
PostgreSQL dump was streamed to the private operator backup directory
`PhpstormProjects/.sislexa-backups/tenant-20260920T123042Z` and its archive directory
validated. A local restore of production user/session tables retained identical
rows after migration. The four new tenant/tariff tables are additive; reverting
application images must not overwrite subsequent user activity with the old dump.

All fourteen application containers were running, every configured healthcheck
passed, and all eight providers were ready. A session issued before the upgrade
remained valid. Every existing user has exactly one personal tenant, owner
membership and tariff assignment; new accounts create these atomically. Live
checks passed foreign-tenant rejection, admin-only tariff mutation, cookie CSRF,
optimistic revision conflicts, immediate capability enforcement through all four
tool APIs, stale WebSocket closure and admin recovery from an empty tariff.
Changing tariffs preserved the system role. HTTPS mobile login, account display,
tariff editing and assignment passed without page errors or horizontal overflow.
Temporary accounts, sessions, tenants, test tariff and credential files were removed;
final database cardinality and cleanup checks passed.

Provider metadata/scopes, immediate grant revocation, frontend SRI, tool-to-Core
callbacks and the external LLM/Browser Runner health checks passed. Piper produced
a valid 179476-byte WAV and Whisper `large-v3-turbo` recognized the fixture phrase.
After deployment, unused builder cache was removed while retaining runtime and
rollback images and all volumes. Free root filesystem space was approximately
1.2 GiB; capacity expansion remains an operational follow-up before another large
image build.

### Production 0.1.317 verification

Production 0.1.317 (`747c8632478977878b6028939f869d9b68d6c5e9`, PR #217)
completed through installed `voicechat-deploy` at 2026-09-21 11:06:10 UTC.
Identity 1.2.0, Billing 1.0.0, SDK 1.0.0 and Image Studio 1.0.5 are pinned to
their independent releases. The canonical fast and pre-PR gates passed, including
2,387 Core tests and all 807 browser tests. Fifteen application containers match
the prepared image IDs, all configured healthchecks pass, and Core plus its
eight dependencies report ready.

The fresh backup is `/var/backups/voicechat/sislexa-billing-20260921T103534Z`
with the PostgreSQL dump and retained verification logs in the workstation's
private `.sislexa-backups/billing-20260921T103534Z` directory. Full restore and
Identity migration preserved users, sessions, tenants and tariff rows byte-for-byte;
stable IDs survived repeated initialization. Provider registries were backed up
through SQLite's backup API. Existing registry entries, session signing material
and dependency URLs were preserved. New grants allow Billing to verify users with Identity, and Core to reserve
and claim execution through Billing.

`/etc/voicechat/prebuilt-0.1.317.yml` is the invocation-only overlay selecting
fifteen immutable application images without build targets. The backup retains
`rollback-0.1.316.yml` and fourteen prior images; its Compose resolution was
verified, but an actual rollback was not executed. Rollback retains the Billing
ledger and additive stable-ID table. The runner admission endpoint paused new
model work while existing requests finished; both runners returned to their
previous non-draining state immediately after deployment readiness.

Live acceptance preserved a pre-release user session and verified stable user/tenant
identity across Core, Identity and Billing. Tests covered tenant isolation,
component/user token separation, admin-only policy changes, cookie CSRF, revision
conflicts, budget rejection, a single execution claim, settlement replay and final
balance. Provider scopes, immediate revocation, actual tool-to-Core RPC, frontend
SRI and external LLM/Browser Runner health passed. HTTPS browser login/account,
image upload/read and full-size viewing passed with zero page errors. The separate
local studio on 18897 also passed production login, gallery creation, local upload,
viewer, logout and mobile layout. Release-created users, galleries, ledger rows
and private probe credentials were removed afterwards.

This release does not yet meter real model executions through Billing. No paid
model/image generation or real payment was submitted during these checks.

### Production 0.1.318 verification

Core 0.1.318 (`bbada2df126bbd26e1c06feb1373b59c6efcda9b`, PR #219) completed
through installed `voicechat-deploy` at 2026-09-21 18:41:57 UTC. Core image ID is
`sha256:ec1950487611d741b5d22b4cebae62bc0aeed670813ecf6ae15b49d1540a2b71`.
SDK 1.1.0 and Billing 1.1.1 are pinned by immutable upstream archives. Billing
image ID is `sha256:8fc4a530b2849f5d789b32e126b25c3437aaf668954ac0136230f529d7889f9a`.
Both external executors run Runner 0.2.1 from `6e117b2581f663f29ebd6200fbeb4bd9a33d547f`.
Core and its eight dependencies reported ready; scoped grants, token revocation,
tool-to-Core RPC and frontend integrity passed. Only Core/Billing container IDs
changed; the other fifteen Compose containers retained their IDs (automation was
stopped and restarted in place).

The full pre-change backup is
`/var/backups/voicechat/sislexa-chat-accounting-20260921T174002Z`, with the local
copy in `.sislexa-backups/chat-accounting-20260921T174002Z`. It contains the
PostgreSQL dump, private configuration, image references and a consistent Billing
SQLite snapshot. The dump table of contents and SQLite integrity were verified;
the full PostgreSQL restore drill remains the preceding 0.1.317 verification.
`/etc/voicechat/prebuilt-0.1.318.yml` selects fifteen immutable application images
with no build targets. Retain Billing 1.1.1 during a Core-only rollback if
unbounded reservations exist; reverting its accounting semantics is unsafe.

The first attempt failed because Compose cannot start a paused automation
container; the old Core was restarted and verified before retry. Pause admission
only for the idle check, drain executors, then unpause and stop Core/automation
before invoking Compose. Never leave a paused service in an `up` operation.
A dry run then selected exactly Core and Billing for replacement. Preserve release
metadata overrides only for keys already present in each service's Compose
`environment`: adding equivalent image-default values changes its configuration
hash and causes unnecessary recreation. Server-owned orchestration restores
runner admission and stopped/paused upstream containers even on failure.

A synthetic account completed two real Codex turns with `gpt-5.6-sol`. Billing
settled 30,427 and 49,551 micro-USD of explicitly estimated cost (79,978 total).
Both receipts matched the stable user, tenant and Chat origin; resumed cumulative
usage had a nonzero baseline and cached input was subtracted exactly once. Replay
did not debit twice. A finite policy rejected the next request without increasing
request count or spending. HTTPS login/account, CSRF, saved Chat output and image
upload/viewing passed; standalone local Image Studio on 18897 passed login,
gallery creation, upload, viewing, mobile layout and logout with no page errors.
The synthetic identity was disabled, demoted and all sessions revoked. Temporary
credentials and its two CLI profiles were removed; real ledger/receipt evidence
and the fixture conversation remain for audit. No payment integration was enabled.

### Production 0.1.319 verification

Core 0.1.319 (`c2469456d4ef1c519e61118aea217b1bbe7054dc`, PR #220) completed
through installed `voicechat-deploy` at 2026-09-21 19:07:31 UTC. Its image ID is
`sha256:d7bc9047360084e0e7653099ffb82c6ae4f768ddc60678fcdce5ff32f38f65ac`.
Only the Core container was replaced; sixteen other Compose container IDs were
preserved. SDK 1.1.0, Billing 1.1.1 and Runner 0.2.1 remain unchanged. Both
canonical Core gates passed 2,398 tests with 42 expected skips.

The fresh backup is `/var/backups/voicechat/sislexa-ws-bootstrap-20260921T185942Z`
and `.sislexa-backups/ws-bootstrap-20260921T185942Z` locally. PostgreSQL dump
listing and consistent SQLite integrity checks passed, including the new Core
outbox and Billing ledger. `/etc/voicechat/prebuilt-0.1.319.yml` selects the exact
images; the backup retains the full 0.1.318 overlay for rollback. Dry run selected
only Core for replacement before the server-owned deployment began.

Live acceptance sent a saved Chat command immediately after `claude.active`,
before the initial agents snapshot. It was handled exactly once and reached
Billing, whose finite policy rejected it before executor dispatch. The two earlier
real settlements remained exactly 79,978 micro-USD with zero active reservations.
Provider scopes, dependency readiness, tool RPC and frontend integrity passed
again. Local Image Studio UI/API on 18897/18896 remained ready. The reused synthetic
identity was disabled/demoted again, all sessions revoked, temporary credentials
deleted and its regenerated CLI profiles removed. Ledger and receipt evidence
remain intact. This completes the Chat increment, not the wider Make/background,
Analytics, active-time or payment milestones.

### Production 0.1.320 verification

Core 0.1.320 (`d430423ef0dab1137f456e1c099effa752044bea`, PR #222) deployed
through installed `voicechat-deploy` at 2026-09-21 21:19:07 UTC. Identity 1.2.1
(`b90d9471437a06ee2c1a752d4167ce9e0f7c84ad`, Identity PR #4) preserves session
activity Maps across its JSON RPC boundary. No database migration was required.
Both canonical Core gates passed, including 807 final browser tests each.

The invocation-only overlay is `/etc/voicechat/prebuilt-0.1.320.yml`. Core image
ID is `sha256:2008ff802fda4a110b632f594742b8f2df4ad7321d78d3b0b18ca9c65376bdec`;
Identity image ID is `sha256:ae575f8503f4684201dc521f422b53e456c4be8a3d2c0bbffd351a8c4a7664b7`.
Only those two containers were replaced; 27 other container IDs were unchanged.
The backup is `/var/backups/voicechat/sislexa-users-rpc-20260921T195641Z`, copied
to the workstation's private `.sislexa-backups/users-rpc-20260921T195641Z`.
Its PostgreSQL archive was checked with `pg_restore --list`, not a full restore.

Fifty-seven component/readiness/authorization/frontend-integrity checks passed.
Both reported admin user-list URLs returned HTTP 200 (37–96 ms from the server)
and normal browser sign-in showed the user rows and live session activity without
JavaScript errors. Signup remained HTTP 200. Browser startup nevertheless took
19–20 seconds because its separate monthly usage-summary request held Core's
database lane. This follow-up performance issue remains tracked in
`log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-users-page-startup.md`;
fast individual API probes must not be treated as proof of fast page startup.

### Production 0.1.321 verification

Core 0.1.321 (`ec018f207b7f2ac6004d703694f712dc253b1faa`, PR #223) deployed
through installed `voicechat-deploy` at 2026-09-21 21:45:53 UTC. Its monthly
usage-summary query decodes message metadata once and aggregates model groups
once, avoiding the long shared database-lane blockage on Users page startup.
No schema migration was needed. Both canonical Core gates passed (2,402 tests
passed, 42 skipped each), as did the focused SQLite and PostgreSQL checks.

The overlay is `/etc/voicechat/prebuilt-0.1.321.yml`; Core image ID is
`sha256:823f40c88f1519e2ac9e461ba25af9c2dc8b6bad7b523c2f0bffe78227b58529`.
Only Core's container changed; all 28 other container IDs were preserved.
Identity remains 1.2.1. The backup is
`/var/backups/voicechat/sislexa-users-startup-20260921T213853Z`, with a private
workstation copy under `.sislexa-backups/users-startup-20260921T213853Z`.
The PostgreSQL archive passed `pg_restore --list`; this was not a restore drill.
The previous 0.1.320 image and overlay remain available for rollback.

All 57 component/readiness/authorization/frontend-integrity checks passed. A real
Chromium sign-in and full Users navigation displayed the rows in 1,800 ms, versus
19–20 seconds before this query change. Three rounds of both reported user-list
URLs and signup returned HTTP 200 in 59–112 ms with no JavaScript errors. The
temporary administrator and sessions were revoked and removed afterwards.
This verifies the page's bounded monthly query, not unbounded historical reports;
large-range usage analytics still needs precomputed projections.

## Core 0.1.322 owner-library cutover (2026-09-22)

Core PR #226 and release 0.1.322 use commit
`55f5a95bd415676cfde85d763dc69a31b61dcb2f`. Both canonical Core gates exited 0,
including 119 browser cases each. The Linux AMD64 image was built locally from a
clean Git archive and deployed through installed `voicechat-deploy`; only Core's
image changed, with all 26 other running container images retained. Owner service
versions were not upgraded in this rollout. The deployment checked nine managed
components and the subsequent production smoke checked provider grants, rejection
of unauthorized requests, frontend integrity and both execution backends.

The first browser acceptance attempt exceeded the ten-second Users-page threshold;
its cause was not established. A fresh authenticated repeat loaded the users list
in 1,296 ms, had no JavaScript errors and returned all nine sampled Users/signup
requests with HTTP 200 in 65–136 ms. This does not establish a cold-start latency
bound. The temporary diagnostic admin was revoked and deleted after each attempt.

Rollback is release/0.1.321 with its preserved image/configuration. The private
backup at `/var/backups/voicechat/sislexa-direct-libraries-20260922T001850Z` contains
configuration, live SQLite backups and image references. The PostgreSQL dump is
stored in the operator's `.sislexa-backups/direct-libraries-20260922T001850Z`; its
restore listing has 1,145 entries. This checks archive readability, not a restore.

## Owner-artifact cutover 0.1.323 (2026-09-22)

Core PR #227 / `971afbced99e14f1b2411ee48d70a3501882326f` removed the remaining
application adapters, product internals/tests and embedded CLI runner. The clean
release image is `sha256:a2c49174f9586ebc6303b58310d605672fe06dbf21f40284c781f12d5429f4d9`.
Both canonical Core gates passed, including all 126 browser cases. Owner artifacts
are pinned by full source SHA in `deploy/tools.lock.json`, `vendor/owner-artifacts.json`
and the npm lockfile. Thirty-one retired source directories are absent; sixteen
owner-manifest archives were checked for provenance, integrity and exclusion of
internal tests/stories. UI-library archive ownership was checked separately.

Installed `voicechat-deploy` completed at 04:46:08 UTC with all nine managed
components ready. It runs Make 1.2.1, Playwright Reader 1.2.2 (including Browser
Runner), Web Reader 1.2.1, Image Studio 1.1.2, Voice 1.1.0, Identity 1.3.1 and
Billing 1.1.3. The separate runner host runs LLM Runner 0.3.1. Core consumes SDK
1.1.2 and UI Kit 0.1.3/Foundation 0.1.6 directly. Owner test-only follow-ups do
not require replacing an unchanged runtime image.

The persistent controller first checked idle CI/automation/LLM execution, paused
upstream admission and drained runners. The first runner attempt restored 0.2.1
because an order-sensitive mount assertion rejected the same mounts in a different
Docker order. The retry compared complete mount records sorted by destination,
revalidated the original stopped-writer archive and preserved all six volumes.
Runner backup details are in `sislex/llm-runner/docs/operations.md` (PR #11).
Temporary cross-host deployment credentials were verified removed afterwards.

Core's private backup is
`/var/backups/voicechat/sislexa-owner-artifacts-20260922T031600Z`; the PostgreSQL
archive is in the operator's `.sislexa-backups/owner-artifacts-20260922T031600Z`.
This archive was actually restored into an isolated local PostgreSQL database:
8 users, 987 conversations, 7 projects and 4,167 CI runs matched the snapshot.
The temporary restore database was deleted. Provider registries and local ledgers
have consistent SQLite backups; previous images and Compose inputs are retained.

Production checks confirmed provider-specific grants, scope/revocation enforcement,
user/service credential separation and frontend SRI. Real Codex returned the same
expected marker before and after the runner upgrade. Piper produced a 128,276-byte
WAV and Whisper large-v3-turbo completed Russian transcription. The independent
account loaded access/history/machines and fit 390px without JavaScript errors.
Claude login was already expired before deployment and still needs interactive
login; CLI availability is not authenticated provider acceptance.

The first post-deploy login/service probes timed out while account usage reporting
held Core's shared database lane for roughly 26 seconds. A later Users navigation
took 2,808 ms and all nine sampled Users/signup requests returned 200 in 136–197 ms,
but that repeat did not close acceptance: Make could still return 503 behind the
account report. Core PR #228 / 0.1.324 addresses the remaining account-query cause;
its rollout and final tool acceptance must be recorded before closing the plan.

## Core 0.1.324 final extraction acceptance (2026-09-22)

PR #228 / `ddcd07c389196bc2b31b92867e58336b9f76e512` materializes account/period
message metadata before account usage joins. No schema or persisted-data change
was required. Both canonical gates exited 0 (2,345 server tests passed, 42 skipped)
and all three report regressions also passed on PostgreSQL. The clean image is
`sha256:465f1e34a1f7ab191ebaeea4cc0554af0270d2848260e54cd2ce7a6910127dd9`.
Installed voicechat-deploy completed at 05:05:58 UTC; the persistent controller
exited 0 and restored admission. Only Core was replaced; all 26 other running
container IDs and image IDs were preserved.

The first final Users browser run loaded rows in 1,805 ms with no JavaScript
errors. All nine sampled Users/signup requests returned 200 in 64–101 ms. Parallel
account usage/profile/Users samples returned 200 in 69–172 ms. Authenticated
component smoke passed all metadata, readiness, provider grant, scope/revocation,
frontend-integrity and tool-to-Core RPC checks. Browser checks passed Make file
write/preview, Image Studio, Web Reader iframe and actual Chromium navigation/frame.
Studio upload/read/delete preserved the exact bytes. Standalone Account loaded
its tabs and fit 390px without JavaScript errors. A real Codex completion through
0.1.324 again returned the expected marker. Voice service images are unchanged
from the successful 0.1.323 synthesis/transcription check above.

The temporary administrator/sessions were revoked and deleted after acceptance,
and its isolated profiles were removed from both runners. Test conversations were
deleted through their API. Production credentials were not copied into source or
published artifacts. Existing Claude login expiry remains the limitation described
above; no successful Claude completion is claimed.

The 0.1.324 operator Compose chain included
`/etc/voicechat/prebuilt-0.1.324.yml` (superseded by 0.1.325 below). Its effective configuration has fifteen pinned
application images and zero build targets, so a standard installed deploy reuses
the accepted artifacts. Replace this active overlay when preparing a later release;
leaving an older overlay last would override new image inputs. The previous operator
environment, full effective Compose definition, container inventory, rollback
0.1.323 overlay and deployment result are in
`/var/backups/voicechat/sislexa-account-usage-324-20260922T050437Z`.
It references the actually restored 0.1.323 data backup. Rollback to Core 0.1.323
retains the same owner images and data format; it also reintroduces the slow report.


## Independent device-client deployment (Core 0.1.325)

Core 0.1.325 (`823ce54a94c7cca5e2b65da1a6b9a369fe94be27`) consumes Agent
0.20.0 and Desktop 1.0.2 owner artifacts. The active operator Compose chain ends
with `/etc/voicechat/client-artifacts-0.1.325.yml` and
`/etc/voicechat/prebuilt-0.1.325.yml`. The former mounts
`/opt/sislexa/client-artifacts` read-only at `/client-artifacts` and sets
`VC_AGENT_APP`, `VC_DESKTOP_APP` and `VC_LOGIN_APPLICATION` to versioned DMGs.
Downloads no longer depend on retired Core source/build directories. Only macOS
ARM64 installers were built in this rollout; other platforms require owner builds.

Desktop uses the secure custom origin `sislexa://app`; Core allows that exact
origin by default. An operator-provided `VC_CORS_ORIGINS` override must include
it for Desktop login. Standard HTTPS certificate validation still applies.
Production acceptance exercised actual Desktop login, published Agent connection
and exec, installer SHA-256, all managed dependencies and Web tool/account flows.
Installed `voicechat-deploy` replaced only Core. Backup and rollback to 0.1.324 are
recorded in `/var/backups/voicechat/sislexa-agent-desktop-325-20260922T080207Z`.

### Retired work-runner volume removal (2026-09-20)

On core host `89.125.68.35`, `voiceaichat_vc-runner-work-data` contained about
2.5 GiB of retired `cli-users` profiles. With explicit operator approval, removed
only this volume using `docker volume rm`. Immediately before deletion, verified
that no running or stopped container referenced it and no container bind-mounted
its data directory. Confirmed the volume was absent afterward.

The active work runner on `45.135.182.251` remains healthy and uses the separate
`llm-runner-work-data` volume on that host. The destination migration backup
`/var/backups/llm-runner/from-core-20260919/profiles.tar.gz` remains intact
(1430635304 bytes); a complete archive scan passed and found 3455 work-data entries.
Rollback now requires the retained backup or current remote profiles rather than
the deleted historical core-host volume. No current-file checksum comparison
against the migration archive was performed.

After deletion, Core 0.1.316 health and all seven dependency readiness checks
passed. The root filesystem reported about 11 GiB available; this is an observed
free-space snapshot, not an amount attributed entirely to the 2.5 GiB removal.


### Production cleanup candidates (2026-09-20 snapshot)

After the retired work-data volume removal, core-host Docker reported no
reclaimable images and no build cache. Unreferenced `vc-codex` remains about
357 MiB and `vc-claude` about 24 KiB; these are historical credential/session
profiles, not generic caches. Three anonymous unreferenced volumes are only
4 KiB each. Do not infer safe deletion of profile data from an unused flag.

Re-downloadable host caches include npm `_cacache` (149 MiB), apt archives
(135 MiB directory), Electron (102 MiB) and Playwright browsers (656 MiB).
No container mounted `/root` or those cache directories, and no process used
`/root/.cache/ms-playwright` at audit time. Removing browser caches can require
reinstallation before the next host-side browser test; recheck active work first.
System journal uses 512 MiB. Reduce archived journal retention if approved;
compressing rotated `syslog.1` (225 MiB) can retain evidence with less disk use.
Do not remove active logs indiscriminately.

Backups occupy about 3.8 GiB (`voicechat` 2.4 GiB, `llm-runner` 1.3 GiB) and
`/root/ChatAI/projects` about 4.4 GiB. Backup retention needs an explicit choice of
recovery points; project directories need the application's tracked cleanup
workflow. No additional candidates were deleted during this audit.

## Cross-service accounting and independent browser UI (Core 0.1.329)

Core 0.1.329 (`c6c97eb1b1772a156ad5806bdcdb008e28c55c39`) deployed through
the installed `voicechat-deploy` flow on 2026-09-22. The release adds the managed
Analytics dependency and the Core proxy for authenticated account reports and
activity intervals. Production runs Identity 1.3.2
(`a64928e585c774d139a50fde5c2db1bdaff3c798`), Billing 1.2.0
(`9ecb733d50ddc96774ddf382268918f6c2f5459e`) and Analytics 1.2.2
(`5a8a6542b798df351cb876a843452133dc717b14`). All ten managed components
reported ready after the installed deploy completed.

The first Analytics deployment exposed an incorrect minimum Billing API
requirement: Billing application 1.2.0 publishes its report route under API 1.1.0.
Analytics 1.2.1 corrected that compatibility declaration. The authenticated
browser acceptance then found that the account view recalculated its implicit
report end time on every render, repeatedly issuing successful report requests
without leaving the loading state. Analytics 1.2.2 captures one boundary per
mounted view and includes the regression test.

Core UI 1.3.1 (`0326fa05402bcdf45289cbc1f536e8a76296a695`) was installed
with `voicechat-ui-deploy` as the active immutable browser release. The previous
1.3.0 release remains installed for rollback. The Core container ID and start time
were unchanged by both UI activations. Production Chromium acceptance signed in
with a temporary developer account, opened `#/account`, rendered cost, token and
active-time totals, and observed exactly one 200 response from
`/api/analytics/account` plus a successful activity write. No page or request
errors occurred. The temporary account and sessions were deleted afterward.

The operator overlay is `/etc/voicechat/prebuilt-0.1.329.yml`; component
configuration remains under `/etc/voicechat/components-0.1.315`. The private
workstation backup is
`.sislexa-backups/cross-service-accounting-20260922T234810`; its PostgreSQL
archive passed `pg_restore --list`, while this was not a full restore drill.
Rollback can reactivate Core UI 1.3.0 without restarting Core. A backend rollback
uses the retained 0.1.328 release checkout/image and must also remove the Analytics
Compose/config additions as one configuration change.

## Team tenants and shared budgets (Core 0.1.330)

Core 0.1.330 (`8f7444340e7490a518515c6658a0e11e46891f84`) deployed through the
installed `voicechat-deploy` flow on 2026-09-23. Production runs Identity 1.4.2
(`c7aaebd15a607887e137d997a9efd1cdcd6ebcaa`), Billing 1.2.2
(`bf811d60c3a7f4764910ce94b5d67fa8076e891c`) and the unchanged Analytics
1.2.2. All ten managed components reported ready. The active operator overlay is
`/etc/voicechat/prebuilt-0.1.330.yml`; component configuration remains under
`/etc/voicechat/components-0.1.315`.

Billing 1.2.2 forwards `x-sislexa-tenant-id` when it asks Identity for a live user
verdict. Identity remains responsible for membership validation, and Billing still
rejects a returned tenant that differs from the requested tenant. Without this
forwarding, a valid team request was verified in the user's personal tenant and
failed with `tenant_access_denied`. The production acceptance used two users in one
team with a 100 micro-USD policy: the first 60 micro-USD reservation made a second
60 micro-USD reservation fail with `budget_exhausted`; releasing the first hold let
the second user reserve 60. Reservation principals retained the individual user ID
and shared the team tenant ID. The test policy was restored to unlimited afterward.

The same acceptance created a team, invited and accepted a member, rejected an
outsider's selected-tenant request, transferred a project and its project
conversation from a personal tenant, and verified that the personal context no
longer exposed them. Project ACLs remain explicit inside a team: the invited tenant
member received project detail access only after the project owner added that user
as a project member. Temporary projects, teams, accounts and sessions were deleted
after acceptance.

Core UI 1.4.0 (`0d8c68a916715915c7cc8d61bbf018fa76387942`) was installed and
activated with `voicechat-ui-deploy`. Core's container ID and start time did not
change. UI 1.3.1 remains the previous activation for immediate rollback.
Production Chromium acceptance signed in, opened `#/account`, listed personal and
team workspaces, selected the team, rendered its member and role, and rendered the
cost, token and active-time sections.

The first Core image attempt copied 123 files with mode `0600` and two directories
with mode `0700` from the production release checkout. The runtime drops to the
`node` user, so it first failed to read `config.ts` and then could not traverse the
`browserUi` directory. Core stayed on 0.1.329 while the checkout and image modes
were normalized, then the exact 0.1.330 source was redeployed successfully. When an
image is built from an operator checkout, verify that every tracked runtime file is
readable and every tracked parent directory is traversable by the runtime user;
also run a read probe as that user before changing the active overlay.

The pre-deploy backup is
`/var/backups/voicechat/sislexa-team-tenants-20260923T005057Z`; its workstation
copy is `.sislexa-backups/team-tenants-20260923T005057Z`. The PostgreSQL custom
archive passed `pg_restore --list` with 1,155 entries, and the copied archive and
Billing snapshot hashes match their server copies. This validated archive
readability, not a restore drill. The 0.1.329 Core image, Identity 1.3.2 image,
Billing 1.2.1 image and UI 1.3.1 release remain available as rollback inputs.

## Image Studio executor repair (LLM Runner 0.3.4)

Image Studio generation failed on the separate runner host with `bwrap: No
permissions to create new namespace`. Ubuntu 24.04 AppArmor restricted the
unprivileged user namespace that Codex `workspace-write` uses. LLM Runner 0.3.2
introduced the repository-owned `llm-runner-bwrap` AppArmor profile and applies
it only to the Codex-enabled work runner together with `no-new-privileges` and an
unconfined seccomp policy. The production container has no added capabilities and
does not use privileged mode. A real Bubblewrap namespace probe passes there.

The same investigation found that the image lacked the rendering tools named by
the Image Studio prompt. LLM Runner 0.3.3 adds Python Pillow and ImageMagick.
Version 0.3.4 (`63514a5eda882272100c7cb426aabc72f85cdd56`) also defaults a
user-scoped run without a project `cwd` to the user's isolated profile home. This
is writable by Codex and is the same root exposed through the authenticated
Runner file API. PRs #12 through #14, their release gates, and all local gates
passed. The 0.3.4 GHCR publish job was blocked before runner allocation by the
GitHub account billing/spending limit. That incident led to the server-owned
release flow described below; no account or registry fix is now required.

Production runs image `sislexa-llm-runner:0.3.4-63514a5eda88`; all three runner
containers are healthy. Pillow and ImageMagick produced valid PNGs. A real Codex
`acceptEdits` run with no `cwd`, matching Image Studio, created a 32×32 PNG in the
user profile; `/v1/files/read` returned the valid PNG to the caller. The temporary
profile and generated file were removed.

The deployment preserved the six runner volumes. Its stopped-writer archive is
`/var/backups/llm-runner/0.3.2-fdec065ed501/profiles.tar.gz`, with SHA-256
`6925c7afef09cb9621303a3dbfc1c52d9110bda46912751f4a96b71c0bc64fc9`.
The final 0.3.4 configuration and rollback inventory are in
`/var/backups/llm-runner/0.3.4-63514a5eda88`; the previous 0.3.3 image remains
available for rollback.

## Server-owned LLM Runner releases (0.3.5)

LLM Runner PR #15 removed its GitHub Actions workflow and GHCR dependency.
Release tag `v0.3.5` at commit
`ad0819ab77d17eb4abfc993f7a603de8499f1440` created no Actions run. The dedicated
runner host now checks out the exact tag, reruns the canonical gate, Compose
tests and dependency audit, builds the `linux/amd64` image, then checks the
authenticated API, Bubblewrap, Pillow and ImageMagick in a disposable container.
It writes an atomic release manifest only after every check succeeds.

The first server-owned run passed 489 Vitest cases, eight operational Node tests,
four package/release tests, five Compose tests and an audit with zero
vulnerabilities. Its manifest is
`/opt/llm-runner/releases/ad0819ab77d17eb4abfc993f7a603de8499f1440/release.json`.
Production pins immutable image ID
`sha256:5e18dcd5db0813b67f57a5da259041b1b12d49949895d5d13407a7fe6e654f7c`
instead of a mutable tag. Work, personal and callbacks are healthy; both
executors report zero active runs. The work service retains
`no-new-privileges`, `seccomp=unconfined`, and `apparmor=llm-runner-bwrap`, with
no added capabilities and without privileged mode.

The first deployment attempt passed both new-image smoke checks, then its
operator helper failed while writing the persistent image reference. Automatic
recovery restored 0.3.4 and reopened Core and automation. The corrected second
attempt deployed 0.3.5 and atomically updated `RUNNER_IMAGE`. Records are in
`/var/backups/llm-runner/0.3.5-ad0819ab77d1` and
`/var/backups/llm-runner/0.3.5-ad0819ab77d1-attempt2`; 0.3.3 and 0.3.4 remain as
rollback images. Core, automation, Image Studio API/UI and the public signup
probe were healthy after deployment.

## Delivery Control coordinator foundation (2026-09-24)

The independent coordinator API 0.2.0 runs on the LLM Runner host
`45.135.182.251`, reached through Core `89.125.68.35` and WireGuard `10.77.0.2`.
`delivery-control.service` uses a dedicated unprivileged account, a 256 MiB memory
limit and 50% CPU quota. API access is loopback-only at `127.0.0.1:8798`.
The independent PostgreSQL 17 container `delivery-control-postgres` listens on
`127.0.0.1:15478`, uses volume `delivery-control-postgres-data`, and is capped at
384 MiB / 0.5 CPU. All three LLM Runner container IDs, start times and health states
were unchanged by this deployment.

The owner repository is [sislex/delivery-control](https://github.com/sislex/delivery-control).
The current published/deployed source is
`c8cb8e3afcc8a9f788be9037a146159069650e22`, installed at
`/opt/delivery-control/releases/0.2.0-c8cb8e3afcc8`. Source archive SHA-256:
`ed38bedc40c85cd788b7aacfc19f6ce96efde3408e21e07240b2b87276acf2cb`.
Archives are retained under `/opt/delivery-control/artifacts`; `release.json`
records provenance, acceptance and activation. The initial 0.1.0 release at
`/opt/delivery-control/releases/0.1.0-77fab9c7cb36` remains available for rollback.
Rolling back from state schema v2 requires restoring the matching v1 database
backup as well as the old service unit; source-only rollback is incompatible.

Credentials stay private under `/etc/delivery-control`. The daily
`delivery-control-backup.timer` writes dumps to `/var/backups/delivery-control`;
initial bootstrap included a disposable restore drill. The pre-v2 migration backup
is `control-20260924T151923Z.dump` in that directory, with a SHA-256 sidecar.
Automatic retention and the complete artifact backup workflow belong to B04.

The shared-chat run is pinned to Core commit
`1e76f1828e8cc8fcb3203d9820007677ce1c5aa0`: 37 tasks, **S0 paused**.
B01, B02 and B03 are recorded as done through explicit external bootstrap
acceptance, with source commit and validation evidence. This records operator-led
implementation rather than inventing worker attempts. B04–B06 remain blocked;
no product task has started and no production worker machine is enrolled.

The API now verifies the pinned Markdown against its compiled manifest and DAG,
reserves machine resources, fences task and role leases, and shares bounded patch
artifacts alongside durable events and idempotent commands. Migration to JSONB
state v2 pauses old runs and requires source verification. Separate host supervisors
provide multiple independent slots, per-attempt clones/runtime names, Codex
execution, owner gates, process cleanup and restart recovery. Scheduling budgets
are not OS resource containment; external runtime lifecycle needs owner adapters.
Enrollment and persistent user-service instructions are in the owner repository's
[worker guide](https://github.com/sislex/delivery-control/blob/c8cb8e3afcc8a9f788be9037a146159069650e22/docs/workers.md).

Owner typecheck/tests/build and disposable PostgreSQL integration passed on the
workstation and Linux deployment host. A three-slot fault scenario verified killed
worker/descendant cleanup, sibling completion, new-epoch retry and supervisor
restart. Three real Codex CLI workers independently produced gated fixture patches.
Worker service installers were supplied but not installed as production workers.
B04–B06 still own dashboard/draining, full artifact handling, publication/release,
automated QA/defect repair and stage acceptance. No stage-advance API exists.

Operators can forward local `18798` to runner loopback `8798` through Core using
`HostKeyAlias=45.135.182.251` for the existing verified host key. Local connection
metadata and the private administrator token are under
`~/.config/sislexa/delivery-control`; never distribute them to ordinary workers.
Each physical worker machine needs its own token and one supervisor with separate
slots; multiple agents must not share task checkouts or enroll one host twice.
