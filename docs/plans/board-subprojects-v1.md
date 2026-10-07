# board-subprojects-v1 — задачи прогонов видны на досках подпроектов

Ран `board-subprojects-v1`. Ветка задач — `dev`.

Владелец, 2026-10-07: у пользователя admin должны быть все проекты Sislexa, а задачи, которые делаются
в подпроектах, должны быть видны на канбан-доске этих проектов по ходу работы.

## Что сделано оператором (2026-10-07)

- Проект ChatAI переименован в Sislexa, Make — в sislexa-make. Для admin созданы проекты остальных
  репозиториев Sislexa: sislexa-core-ui, sislexa-ui-kit (`sielexa-ui`), sislexa-sdk, sislexa-agent,
  sislexa-desktop, sislexa-delivery-control, sislexa-identity, sislexa-billing, sislexa-analytics,
  sislexa-llm-runner, sislexa-voice, sislexa-image-studio, sislexa-web-reader,
  sislexa-playwright-reader; Sislexa Kanban уже был. Всего 17 проектов, по одному на репозиторий.

## Что есть сейчас

- Координатор (`src/board-sync.ts`) кладёт карточку `delivery-control:<run>:<task>` в проект прогона
  (`run.projectId`) через `PUT /integrations/v1/projects/:id/external-tasks/...` ядра с токеном
  интеграции из `DELIVERY_BOARD_TOKEN_FILE`. У всех прогонов проект — Sislexa, поэтому задачи Make,
  Kanban и других репозиториев видны только на доске Sislexa.
- Токен интеграции привязан к одному проекту: `resolveIntegrationToken` (`apps/server/src/db/repos/projects.ts`)
  возвращает `projectId`, вход ядра (`routes/integrationIngress.ts`) и Kanban (`internal/forwardedAuth.ts`,
  через `/internal/whoami`) сверяют его с `:id`.

## Решения

1. Один токен интеграции может покрывать несколько проектов одного владельца (список проектов
   задаётся при выпуске; владелец должен быть owner каждого).
2. Карточка задачи попадает на доску проекта своего репозитория (карта «репозиторий → проект» в
   конфигурации координатора); прогоны без записи в карте — как сейчас, в проект прогона.

| B01 | Core | — | Multi-project integration tokens. In `packages/shared` extend the integration token contract: a token has `projectIds: string[]` (1–50, unique) instead of a single project, keeping `projectId` as the first entry for compatibility in responses; `IntegrationPrincipal` gains `projectIds`. In `apps/server`: storage migration (existing tokens become one-element lists, SQLite and Postgres), `POST /api/projects/:id/integration-tokens` accepts optional `projectIds` (must include `:id`; the caller must be owner of every listed project, otherwise 403), listing and revocation unchanged; `resolveIntegrationToken` returns `projectIds`; the ingress `PUT /integrations/v1/projects/:id/external-tasks/...` accepts when `:id` is in `projectIds`; `/internal/whoami` returns `projectIds` (and `projectId` for older consumers). Tests: issue for several projects, refuse non-owned project, ingress allow/deny by list, migration of existing tokens, whoami payload. Update docs/kb (data-auth, protocol). Gate: `npm run gate:task -- --base <sha>`. |
| B02 | Kanban | — | Accept multi-project integration principals. The external task route (`PUT /api/projects/:id/external-tasks/:source/:externalId`) and `internal/forwardedAuth.ts` accept a Core whoami integration principal whose `projectIds` contains `:id` (fall back to `projectId` when `projectIds` is absent, so the current Core keeps working); everything else unchanged. Tests for both payload shapes, deny for a project outside the list. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
| B03 | delivery-control | — | Board cards on the repository's project. Add optional `DELIVERY_BOARD_PROJECTS_FILE` (JSON `{ "<owner/repo>": "<projectId>" }`, private file like the token file): `board-sync.ts` puts each task card on the project mapped from `task.repository`, falling back to `run.projectId`; the card keeps run id, stage, task id, state, attempts, last failure code, gate result, PR/merge link and a link back to the run, and its title is prefixed with the run id. When the target project of an already synced card changes (mapping added later), upsert on the new project and mark the old card done with a note «moved to <project>» once. The same token file is used for every project (Core B01 multi-project token; with a single-project token the other projects get 403, which is reported once per project and does not stop syncing the rest). Tests: mapping used, fallback, move between projects, 403 isolation, file permission check. Update docs (board sync, operator setup). Gate: `npm run gate:task -- --base <sha>`. |
