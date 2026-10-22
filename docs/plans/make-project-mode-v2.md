# make-project-mode-v2 — остаток C01: стенд, перенос в Sislexa, инструменты ассистента

Ран `make-project-mode-v2`. Ветка задач — `dev`.

Продолжение [make-project-mode-v1](make-project-mode-v1.md). Задача C01 сделала в ядре `listProjects`,
`projectStructure`, `projectDesign` и `projectGit` (PR #474). Модель остановилась на трёх частях:
`standPreview`, `createTransferTask` и MCP-инструментах ассистента. Владелец, 2026-10-07: сделать весь
план максимально быстро и параллельно — поэтому остаток идёт отдельным прогоном одновременно с C02 v1.

## Что есть сейчас

- `apps/server/src/makeBridge/localCore.ts`: `LocalMakeCore` принимает зависимости `standPreview` и
  `transferTask`; без них методы отвечают 501. В `server.ts` они не переданы.
- Kanban (B02 v1): `POST/DELETE /api/projects/:id/dev-stands/:standId/components/:component/live`,
  `GET /api/projects/:id/dev-stands/:standId`, `POST /api/projects/:id/dev-stands`. Ядро знает адрес
  Kanban (`config.kanbanUrl`, прокси `kanbanBridge/proxy.ts`); пакет контрактов Kanban для вызова не нужен.
- Карточка с дизайном Make: `components/componentTicket.ts` (`db.tasks.createTask` и `task_designs`).
- MCP-инструменты Make (`mcp__make__*`) живут в сервисе Make, ядро их не регистрирует
  (`makeBridge/boundary.test.ts`).

| B01 | Core | — | Finish Core project mode for Make (continuation of make-project-mode-v1 C01). In `apps/server` wire `LocalMakeCore` dependencies `standPreview` and `transferTask` in `server.ts` and implement them. `standPreview(user, projectId, op)`: call the Kanban dev stand HTTP API at `config.kanbanUrl` on behalf of the user (start or reuse a stand, status with gateway URL, enable and disable live mode for a component with the project working copy path from the project machine), map Kanban errors to status codes; when Kanban is offline answer 503 `stand_preview_unavailable`. `createTransferTask(user, args)`: check the user may write to the target project, create a task on the target project's board with the Make design link (`task_designs`, same as `components/componentTicket.ts`) and create a new branch `make/<slug>` in the chosen repository (Core UI or UI Kit) on the project machine through `GitWorkspaceService` containing the selected files (write files, commit, push); return task id, branch and URLs. Make sure the remote RPC `/internal/make/core` dispatches all six project-mode methods. Tests for both methods (fake Kanban fetch, fake git service), authorization, Kanban offline and the RPC dispatch. Update docs/kb (server-internals). Gate: `npm run gate:task -- --base <sha>`. |
| B02 | Make | — | Assistant MCP tools for project mode in the Make service (`mcp__make__*`), using the `MakeCore` port methods from make-contracts 1.4.0: list projects, project structure, project design inventory, git status/branches/pull/commit/push/new branch, stand start/status/live on/live off, create transfer task to Sislexa. Each tool has a zod input schema, checks the conversation user, returns compact JSON and surfaces port errors (403, 404, 409, 501, 503) as tool errors. Tests with the fake `MakeCore` for every tool: schema validation, success, error mapping. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
