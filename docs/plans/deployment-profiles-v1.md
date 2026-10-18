# deployment-profiles-v1 — несколько сборок на разных адресах и общие сервисы

Ран `deployment-profiles-v1`. Ветка задач — `dev`. Задачи выполняют воркеры MacBook (M2); M1 выключен. Desktop заморожен
(2026-10-18) — задач для него нет. Архивы зависимостей Core больше не лежат в git (`npm run vendor:fetch|publish`).

## Что нужно владельцу

- Несколько **сборок** одного кода на разных адресах (например `sislexa.com`, `sislexa.ru`). У каждой сборки своя база
  (адрес в `.env`; теоретически база может быть общей) и свой набор приложений: только чат; чат + Make; чат + Web Reader +
  Kanban и т. д.
- **Каждый отдельный сервис может быть общим** для нескольких сборок: Make (`make.sislexa.com`), Kanban
  (`kanban.sislexa.com`), Identity (`auth.sislexa.com`, общий вход — по желанию; сборка может держать свою Identity),
  Web Reader, Playwright Reader, Image Studio. Каждое приложение открывается на **своём адресе** (поддомене).
- Пример: пользователь `sislexa.ru` открывает Make → браузер уходит на `make.sislexa.com`, а все запросы ассистента Make
  (ходы модели) идут через ядро `sislexa.ru`: модель, раннер, учёт стоимости и история разговора остаются в его сборке.

## Что есть сейчас (исследование 2026-10-18, origin/dev)

- Переключателя «приложения сборки» нет. Make, Web Reader, Image Studio, Playwright Reader в ядре только
  `embedded|remote` (`apps/server/src/config.ts:287-305`), модули Make/Reader собраны в ядро
  (`packages/shared/src/applicationCatalog.ts:41-60`); Kanban `remote|off` (`config.ts:292`). Корневой
  `docker-compose.yml` жёстко задаёт `VC_MAKE_MODE: remote` и др. (`:73-76`) и `depends_on` на make/image-studio/
  playwright-reader/раннеры (`:47-56`); `deploy/compose.stand.yml:21-32` уже делает их профилями с `required:false`.
- Видимость в UI держится только на правах тарифа арендатора (`PRODUCT_CAPABILITIES` в Identity contracts,
  `moduleAvailable()` в Core UI `App.tsx:964-965`); раздел «Проекты» не закрыт правом и при выключенном Kanban показывает
  «Не удалось загрузить проекты» (`App.tsx:2576,3086`).
- Отдельные сервисы знают ровно одно ядро (`VC_CORE_URL` + `VC_INTERNAL_TOKEN`) и проверяют каждую сессию через
  `/internal/whoami`. Делегирование ходов от приложения в ядро уже есть (`turns.ts` `req.delegation`, `billingSession`,
  учётные данные приложений Identity).
- Окружения Kanban выбирают модули (`packages/shared/src/environment.ts:270-306`), но Kanban и Postgres обязательны
  (`manager.ts:847`, `scripts/prod/environment_stand.py:217-221`), режимы ядра для невыбранных модулей не сбрасываются;
  Release Center выкатывает один прод на проект (`releases/targets.ts:97,119`).

## Общая модель (контракт для всех задач)

**Профиль сборки** = `{ id, publicUrl, database, applications[] }`, где приложение — `{ id, mode: 'local'|'shared'|'off',
url? }`. Идентификаторы приложений: `chat` (всегда включён), `make`, `projects` (Kanban), `web-reader`,
`playwright-reader`, `image-studio`, `identity`.

**Ядро (Core)**
- Переменная `VC_APPLICATIONS`: список через запятую; элемент `id` (локально) или `id=https://адрес` (общий сервис на
  другом адресе); отсутствующий `id` = выключен. Пример: `chat,make=https://make.sislexa.com,projects`. Без переменной —
  текущее поведение (всё включено), для совместимости.
- `coreId` сборки — `VC_CORE_ID` (строка `^[a-z0-9][a-z0-9.-]{1,62}$`, по умолчанию хост `VC_PUBLIC_URL`).
- Манифест для UI и сервисов: `GET /api/system/applications` → `{ coreId, applications: [{ id, enabled, location:
  'local'|'external', url? }] }`.
- Права пользователя = права тарифа ∩ включённые приложения сборки (в `accountContext` / `hasProductCapability`).
- Выключенное приложение: модуль не поднимается, его маршруты отвечают `404 { error: 'application_disabled' }`, его
  инструменты MCP не попадают модели.

**Вход в общий сервис по тикету (между доменами)**
- `POST /api/applications/:id/enter` в ядре сборки (сессия пользователя) → `{ url }`, куда браузер уходит:
  `https://<адрес сервиса>/_sislexa/enter?core=<coreId>&ticket=<тикет>`. Тикет одноразовый, живёт 60 с, привязан к
  пользователю, приложению и `coreId`, подписан ядром.
- Сервис погашает тикет запросом в ядро из своего реестра: `POST <url ядра>/internal/v1/tickets/redeem { ticket,
  application }` с учётными данными этого ядра в заголовке Authorization → `{ user, tenantId, capabilities, expiresAt }`.
  Повторное погашение и чужое приложение — отказ.
- После погашения сервис ставит свою cookie на своём домене; сессия хранит `coreId`. Каждый следующий запрос сервис
  проверяет в том же ядре (как сейчас `/internal/whoami`, но по ядру из сессии).

**Реестр доверенных ядер в каждом общем сервисе**
- Запись `{ coreId, url, credentialRef }`; учётные данные хранятся на сервере сервиса (файл/секрет), не в базе в открытом
  виде и никогда не возвращаются API.
- Регистрация без перезапуска: `POST/GET/DELETE /internal/v1/cores` с административным учётным данным сервиса.
- Режим одного ядра (`VC_CORE_URL` + `VC_INTERNAL_TOKEN`) остаётся как запись реестра по умолчанию — обратная
  совместимость.

**Разделение данных**
- Файлы: `<данные сервиса>/<coreId>/…`. База сервиса: колонка `core_id` (или схема на ядро) во всех таблицах с данными
  пользователей; любой запрос фильтруется по `coreId` сессии.

**Делегирование в ядро пользователя**
- Ходы модели, учёт стоимости, уведомления, MCP-обратные вызовы: сервис обращается к ядру из сессии
  (существующий путь делегирования в `turns.ts`) с учётными данными этого ядра. Инструменты MCP сервиса доступны модели
  по ограниченному токену сессии.

**Общая библиотека** — `@sislexa/component-runtime` (`packages/component-runtime`): реестр ядер, погашение тикета,
выбор ядра на запрос, клиент делегирования, разделение путей данных. Все сервисы подключают её одинаково.

## Задачи интегратора (Claude, вне манифеста)

- После B01: выпуск Shared и component-runtime (`npm run vendor:publish` / `release-composition apply --publish`),
  закрепление в Core, Core UI, Kanban, Make, Identity, Web Reader, Playwright Reader, Image Studio.
- После каждой задачи этапа C — выпуск сервиса, закрепление в Core, проверка на стенде `dev-m2`
  (`http://127.0.0.1:23001`) **до** прода.
- Приёмка на стенде (сборки поднимаются как окружения Kanban на M2 с разными профилями):
  1. **Сборка A (только чат):** нет Make/Kanban/Reader в меню и API (`application_disabled`), «Проекты» не показываются,
     ходы модели работают.
  2. **Сборка B (чат + общий Make):** Make на другом адресе; переход по тикету без повторного входа; ход ассистента Make
     виден в истории и учёте сборки B, не сервиса; файлы мастерской B не видны пользователю сборки C.
  3. **Сборка C (чат + Web Reader + общий Kanban):** доска на `kanban.<адрес>`, данные доски C не видны сборке B.
  4. **Общая Identity (по желанию):** две сборки с `identity=https://auth.<адрес>` — вход один раз, пользователь одной
     Identity работает в обеих сборках.
- DNS и TLS поддоменов на проде — по указанию владельца (адреса и сертификаты не создаются задачами).

| B01 | Core | — | Contracts and runtime library for deployment profiles and shared services (self-contained, repository `sislex/voiceAIChat`, branch `dev`). In `packages/shared` add pure contracts: application ids (`chat`, `make`, `projects`, `web-reader`, `playwright-reader`, `image-studio`, `identity`), parser/serializer of `VC_APPLICATIONS` (`id` or `id=https://url`, comma separated; absent id = disabled; no variable = all enabled), `coreId` validation (`^[a-z0-9][a-z0-9.-]{1,62}$`), the manifest type `{ coreId, applications: [{ id, enabled, location: 'local'|'external', url? }] }`, the enter-ticket redeem request/response `{ ticket, application }` → `{ user, tenantId, capabilities, expiresAt }`, the trusted-core registry entry `{ coreId, url, credentialRef }` and error codes (`application_disabled`, `ticket_invalid`, `ticket_used`, `core_unknown`). In `packages/component-runtime` (Node) add the shared-service library used by every service: trusted-core registry (load from a JSON file path and from env for the single-core default `VC_CORE_URL`+`VC_INTERNAL_TOKEN`; add/remove at runtime; credentials kept server side, never returned or logged), ticket redemption against the issuing core with timeouts and one retry, per-request core resolution from a session record, a delegation client for turns/billing/notifications to the session's core reusing the existing delegation contract of `apps/server/src/turns.ts`, and a data-path helper `<root>/<coreId>/…` rejecting traversal. In Core server add `POST /api/applications/:id/enter` (user session; returns `{ url }` to `https://<service>/_sislexa/enter?core=<coreId>&ticket=<opaque>`; ticket one-time, 60 s, bound to user, application and coreId) and `POST /internal/v1/tickets/redeem` (caller authenticated by the per-service credential configured for that application). Tests for parsing, ticket lifetime/one-time/binding, registry isolation and path safety. Document in `docs/kb/architecture.md` and `docs/kb/data-auth.md`; KB touch/log/index. Integration: every later task consumes exactly these names and formats; do not rename. |
| C01 | Core | B01 | Deployment applications in Core (self-contained, repository `sislex/voiceAIChat`, branch `dev`): read `VC_APPLICATIONS` and `VC_CORE_ID` (B01 contracts) in `apps/server/src/config.ts`; give every application a third state «off» (Make, Web Reader, Image Studio, Playwright Reader today are only `embedded|remote`, `config.ts:287-305`; Kanban already `remote|off`); an off application does not start its module, proxy or MCP registration and its route prefixes answer `404 { error: 'application_disabled' }`; an `id=url` application is external: Core keeps delegation/ticket endpoints for it but does not proxy its UI; effective capabilities = tenant capabilities ∩ enabled applications inside `accountContext`/`hasProductCapability` so existing checks (`accountAccess.ts:61-62`, `turns.ts:453`, STT/TTS) follow automatically; `GET /api/system/applications` returns the manifest; filter runner MCP lists by enabled applications. Compose: move make, image-studio, playwright-reader and the local runners behind profiles in the root `docker-compose.yml` with `depends_on … required: false`, replace hard-coded `VC_*_MODE` literals by variables, and add a generator (extend `scripts/prod/compose_env.py` / `environment_stand.py`) deriving `COMPOSE_PROFILES` and `VC_*_MODE` from `VC_APPLICATIONS`; remove the stand rule that Kanban and Postgres are mandatory (`environment_stand.py:217-221`) when `projects` is off. No variable = today's behaviour. Tests: chat-only, chat+Make local, chat+external Make, chat+Web Reader+Kanban; compose generator matrix. KB (`deploy.md`, `architecture.md`) and touch/log/index. Verify on stand dev-m2 before merge notes. |
| C02 | core-ui | B01 | Deployment applications in the interface (self-contained, repository `sislex/sislexa-core-ui`, branch `dev`): load `GET /api/system/applications` at startup (B01 manifest type) next to session/capabilities; menu, routes and sidebar show only enabled applications; the Projects section and its routes are hidden when `projects` is disabled (no «Не удалось загрузить проекты» error), gated like Make/Reader in `moduleAvailable()`; an external application opens by `POST /api/applications/:id/enter` and a full-page redirect to the returned url (same window; back link returns to the build); keep current behaviour when the manifest endpoint is missing (older Core). DOM tests for chat-only, external Make, Projects hidden; Storybook stories for the menu states. KB per AGENTS.md. |
| C03 | Make | B01 | Make as a shared service (self-contained, repository `sislex/make`, branch `dev`): adopt `@sislexa/component-runtime` (B01): trusted-core registry (single-core default keeps today's `VC_CORE_URL`/`VC_INTERNAL_TOKEN`), `GET /_sislexa/enter?core&ticket` redeems the ticket with the issuing core and sets a Make session cookie on Make's own domain bound to `coreId`, every request resolves its core from the session (replacing the single `/internal/whoami` core), workshop/project files under `<VC_MAKE_DATA_DIR>/<coreId>/…` (migration: existing data moves under the default core id), Make database rows keyed by `core_id`, all assistant turns, billing and notifications delegated to the session's core (model, runner, history stay in the user's build), Make MCP tools exposed to the model with a session-scoped credential, admin registry API `POST/GET/DELETE /internal/v1/cores`. Tests: two cores with isolated data, ticket replay refused, unknown core refused, turn delegated to the right core. KB per AGENTS.md. |
| C04 | Kanban | B01 | Kanban as a shared service (self-contained, repository `sislex/sislexa-kanban`, branch `dev`): same adoption as Make (registry, `/_sislexa/enter` ticket, per-request core, `core_id` on every board/project/task/run/environment row with per-core filtering, delegation of assistant turns/billing/notifications and of Core RPCs `apps/server/src/kanban/core.ts` to the session's core, registry admin API); board UI served on Kanban's own address for external mode while the embedded proxy mode through Core keeps working. Tests for isolation between two cores across boards, CI runs, environments and the assistant tools. KB per AGENTS.md. |
| C05 | Kanban | C04 | Deployment profiles and release rollout (self-contained, repository `sislex/sislexa-kanban`, branch `dev`): add a deployment profile to managed environments (`packages/shared/src/environment.ts`): `applications` (B01 ids with `local|shared|off` and url for shared), shared-service bindings (url + credential reference per application), `publicHost`, kind `production` (no sanitize step, stable address) vs `stand`; provisioning writes `VC_APPLICATIONS`, `VC_CORE_ID` and derived profiles (Core C01 generator) instead of forcing `VC_KANBAN_MODE: remote` and Postgres (`manager.ts:845-847`); registering the environment's core in each bound shared service through its registry API; Release Center: a project may list several deployment targets and a release rolls out to them sequentially with the existing health check after each, stopping on the first failure (replaces the single `productionAgentId` target while keeping it as the default one-target list). Tests for profile validation, generated env, rollout order and stop-on-failure. KB per AGENTS.md. |
| C06 | Identity | B01 | Identity as an optional shared sign-in (self-contained, repository `sislex/identity`, branch `dev`): one Identity can serve several builds: registry of trusted cores via component-runtime, sign-in on `auth.<address>` returning to the calling build with a one-time ticket the build redeems (same contract as B01), users and tenants keyed by realm so two builds may either share users (shared Identity) or stay separate (own Identity in the build's database, today's default). Tests for both modes. KB per AGENTS.md. |
| C07 | Web Reader | B01 | Web Reader as a shared service (self-contained, repository `sislex/webreader`, branch `dev`): adopt component-runtime like Make (registry, ticket enter, per-request core, data under `<coreId>`, delegation, registry admin API), single-core default unchanged. Tests for two isolated cores. KB per AGENTS.md. |
| C08 | Playwright Reader | B01 | Playwright Reader as a shared service (self-contained, repository `sislex/playwrightreader`, branch `dev`): same adoption as Web Reader. Tests for two isolated cores. KB per AGENTS.md. |
| C09 | image-studio | B01 | Image Studio as a shared service (self-contained, repository `sislex/image-studio`, branch `dev`): same adoption as Web Reader, generated images stored under `<coreId>`. Tests for two isolated cores. KB per AGENTS.md. |
