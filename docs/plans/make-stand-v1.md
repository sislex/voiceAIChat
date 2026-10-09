# make-stand-v1 — правка проекта из Make прямо на стенде разработки

Ран `make-stand-v1`. Ветка задач — `dev`.

## Запрос владельца (2026-10-09)

Человек подключает к беседе Make проект из аккаунта и работает с ним на стенде разработки:

1. если проект беседы связан с проектом аккаунта, можно выбрать уже развёрнутый стенд или запустить
   новый на любой машине, подключённой к проекту;
2. Make создаёт ветку и переключает стенд на неё;
3. проект со стенда показывается прямо в Make;
4. править проект можно сразу в Make — и руками в редакторе, и ассистентом; правки видны на стенде без
   выпуска и деплоя.

## Что есть сейчас (origin/dev, 2026-10-09)

- Kanban владеет стендами: `/api/projects/:id/dev-stands` (список, создание 202 + операция, детали,
  удаление), подмена компонента веткой или SHA (`POST …/components/:component`, ветка один раз
  превращается в SHA), живой режим `POST|DELETE …/components/:component/live {workingCopyPath}` — агент
  запускает `npm run dev:component` прямо в рабочей копии, HMR подхватывает правки. Ядро проксирует
  `/api/projects` в Kanban (`kanbanBridge/proxy.ts`).
- Ядро: `MakeProjectAdapters.standPreview` (`apps/server/src/makeBridge/projectAdapters.ts`) берёт первый
  стенд машины или создаёт стенд с первым окружением этой машины, не проверяя `managed`/`ready`/
  `machines[0]`; живой режим — на общую рабочую копию проекта (`projectWorkdir`).
- Make: `MakeProjectStand.tsx` (режим «Проект») — свободное поле «стенд», поле компонента, iframe на
  `gateway.urls[0]`. Контракт `standPreviewOperationSchema` (make-contracts 1.6.0): start/status/url/
  live_on/live_off, без списка стендов, без выбора машины и ветки.
- Ассистент Make пишет только в мастерскую беседы (`<dataDir>/make/<conversationId>`), рабочую копию
  проекта не трогает (`turns.ts`, комментарий про общий чекаут).
- Шлюз стенда — только `http://<LAN|Tailscale>:<port>`. В iframe страницы прода это другой сайт: cookie
  стенда (`SameSite=Strict`) в iframe не отправляются, войти в стенд внутри Make нельзя. Прокси с прода
  нет. Агент уже умеет `tunnel.connect` — TCP-соединение к порту на своей машине.
- Стенды есть только у проекта Sislexa (окружения `dev-base`, `dev-base-m2`); у проекта
  sislexa-core-ui (беседа «Проект 35») окружений и стендов нет, `parentProjectId` пуст.

## Решения

- **Какие стенды видны беседе.** Стенды проекта беседы и стенды других проектов пользователя, в состав
  которых входит репозиторий проекта беседы (`DEV_COMPONENT_REGISTRY[*].repository` совпадает с
  git-репозиторием проекта). Компонент стенда для правки — тот, чей репозиторий совпал. Так беседа в
  sislexa-core-ui видит стенды Sislexa и правит `core-ui`.
- **Новый стенд.** Машины — подключённые к проекту беседы. Создать стенд можно на машине, где у
  проекта-хозяина стендов есть окружение `managed`, `ready`, `machines[0] === машина`; иначе машина
  показывается с причиной («нет готового базового окружения»). Базовое окружение само не разворачивается.
- **Рабочая копия беседы.** Для каждой беседы на машине стенда — отдельный git worktree
  `<projectWorkdir>/../make-worktrees/<conversationId>` (внутри каталога проекта на машине) на своей
  ветке (по умолчанию `make/<slug беседы>-<conversationId[:8]>` от `origin/<ciBaseBranch проекта>`, либо
  существующая ветка). Общая рабочая копия проекта не меняется. Компонент стенда переводится в живой
  режим на эту копию.
- **Правка.** Редактор Make и инструменты ассистента в режиме стенда читают и пишут файлы рабочей копии
  беседы (через ядро и агента, с проверкой границ пути), коммит и пуш — кнопками и инструментами git.
- **Показ.** Ядро прода открывает доступ к шлюзу стенда на отдельном порту того же хоста
  (`http://89.125.68.35:<port>/`, диапазон `VC_STAND_PROXY_PORTS`) через агента машины. Тот же хост —
  тот же сайт, поэтому cookie стенда работают в iframe. Cookie стенда переименовываются с префиксом
  доступа, cookie прода стенду не передаются — вход на стенд не выбивает сессию прода. Доступ к порту
  — только с сессией прода участника проекта-хозяина.
- Make хранит привязку беседы к стенду у себя (`standId`, проект-хозяин, машина, компонент, ветка), ядро
  без состояния: путь рабочей копии вычисляется из `conversationId`.

## Общий контракт (для всех задач)

- **make-contracts 1.7.0** (B01). Новый метод порта `MakeProjectCore.makeStand(userId, conversationId,
  operation)` и RPC-схема `makeStand: { args: [id, id, makeStandOperationSchema], result:
  makeStandResultSchema }`. Операции:
  - `options {}` → `{ component: DevComponentId | null, repository: string | null, stands: [{ standId,
    hostProjectId, hostProjectName, machineId, machineName, online, status, componentSource:
    'base' | 'dev' | 'live', branch: string | null, sha }], machines: [{ agentId, name, online,
    canCreate, reason?: string }] }`;
  - `create { agentId }` → `{ standId, hostProjectId, operationId }`;
  - `attach { standId, hostProjectId, branch?: string, newBranch?: string, baseBranch?: string }` —
    готовит рабочую копию беседы (новая ветка `newBranch` от `baseBranch`, или существующая `branch`,
    или ветка по умолчанию), включает живой режим компонента на ней;
  - `status { standId, hostProjectId }`, `detach { standId, hostProjectId }` (выключить живой режим,
    рабочую копию и ветку сохранить);
  - `files` — `{ action: 'list', dir } | { action: 'read', path } | { action: 'write', path, content } |
    { action: 'delete', path } | { action: 'rename', from, to }` внутри рабочей копии беседы
    (`projectPathSchema`, файл ≤ 2 МБ);
  - `git` — `projectGitOperationSchema` над рабочей копией беседы.
  Результат `MakeStandState`: `{ standId, hostProjectId, machineId, component, branch, workingCopyPath,
  phase: 'idle' | 'creating' | 'preparing' | 'installing' | 'switching' | 'ready' | 'failed', error?,
  previewUrl: string | null, directUrls: string[] }` плюс поля операции (`files`/`git`/`options`).
  Ошибки — коды `stand_not_found`, `machine_unavailable`, `base_environment_missing`,
  `component_not_in_stand`, `branch_exists`, `branch_not_found`, `path_outside_working_copy`,
  `stand_proxy_unavailable`, `operation_conflict`.
- **Доступ к стенду через ядро** (B02): `POST /api/dev-stand-access {projectId, standId}` → `{ url,
  expiresAt }` (продлевается каждым запросом; простой 1 час — порт освобождается). Ядро слушает порты
  `VC_STAND_PROXY_PORTS` (например `8790-8794`; пусто — выключено, тогда `previewUrl: null` и Make
  показывает прямые адреса стенда).
- **Живой режим в рабочей копии беседы** (B03): Kanban принимает `workingCopyPath`, который является git
  worktree внутри каталога проекта на машине (`.git` — файл), ставит зависимости в этой копии
  (`npm ci --prefer-offline`, если `node_modules` нет или изменился `package-lock.json`), в
  `live[]` отдаёт `branch` и `head` копии.

## Задачи интегратора (Claude, вне манифеста)

- После приёмки B01: выпустить make-contracts 1.7.0, закрепить архив в Core (`apps/server`) и раздать
  в Make; настроить этап 1.
- Перед этапом 1 положить копию этого плана в `docs/plans/` репозиториев Make и Kanban.
- Финал: выпуски Make и Kanban, закрепления в Core, релиз ядра; на проде `VC_STAND_PROXY_PORTS=8790-8794`
  и публикация портов в compose, проверка доступности портов снаружи; агенты машин — текущие.
- Проверка сценария владельца на проде: беседа «Проект 35» (sislexa-core-ui) → «Стенд» → стенд M2
  `dev-base-m2` → новая ветка → в превью Make открыт Core UI со стенда, вход проходит; правка файла
  Core UI в редакторе Make и ассистентом видна в превью без перезагрузки; коммит и пуш ветки; сессия прода
  не сбрасывается.

| B01 | Make | — | make-contracts 1.7.0 contract for editing a project on a dev stand from Make, per docs/plans/make-stand-v1.md «Общий контракт» (copy of the plan is in this repository): in `packages/make-contracts/src/projectMode.ts` add `makeStandOperationSchema` (discriminated union by `op`: options, create {agentId}, attach {standId, hostProjectId, branch?, newBranch?, baseBranch?} with at most one of branch/newBranch and branch names validated by the existing `branch` refinement, status, detach, files {action list/read/write/delete/rename with projectPathSchema paths and content ≤ 2 MiB}, git {projectGitOperationSchema}), `makeStandResultSchema` (MakeStandState with phase enum, previewUrl nullable http(s) URL, directUrls, plus op-specific `options`/`files`/`git` payloads), the stable error code list as a const, the `makeStand(userId, conversationId, operation)` method on `MakeProjectCore` and `makeStand` in `projectModeRpcSchemas`; keep `standPreview` unchanged for compatibility; export the new types; tests for every operation schema (valid and invalid: both branch and newBranch, bad branch names, path traversal, oversized content, unknown op) and for the RPC schema registration; update docs/kb/project-mode.md (replace the duplicated stand section with one current description). Do not bump the make-contracts version (the integrator publishes 1.7.0). Gate: `npm run gate:task -- --base <sha>`. |
| B02 | Core | — | Same-site access to a dev stand gateway through Core, per docs/plans/make-stand-v1.md «Решения» and «Общий контракт»: (1) config `VC_STAND_PROXY_PORTS` (range like `8790-8794`, empty disables) and `VC_STAND_PROXY_PUBLIC_HOST` (defaults to the request host); (2) `POST /api/dev-stand-access {projectId, standId}` registered in Core (not under the `/api/projects` prefix proxied to Kanban): checks the session user is a member of projectId, reads the stand from Kanban (`GET /api/projects/:id/dev-stands/:standId` on behalf of the user) for machineId and gateway port, leases a free port from the range (one lease per user+stand, reused), returns `{url, expiresAt}`; idle lease expiry 1 h; 503 `stand_proxy_unavailable` when disabled or the range is exhausted; (3) a listener per leased port: every HTTP request and WebSocket upgrade is authorized by the Core session cookie of the same user (cookies are shared across ports of one host), then forwarded to `127.0.0.1:<gatewayPort>` on the stand machine over the agent tunnel (`tunnel.connect`/`tunnel.data`/`tunnel.end` already used by `apps/server/src/agents/registry.ts`; add a Core-terminated tunnel endpoint returning a Duplex usable as `createConnection` for `http.request` and for raw upgrade piping, with backpressure); the proxy strips all Core cookies from the request, renames stand cookies in `Set-Cookie` to `sxs_<leaseKey>_<name>` (drop `Domain`) and maps them back on requests, rewrites `Host` to the gateway and `Origin` equal to the proxy origin to the gateway origin, supports SSE streaming and WebSocket; unauthorized requests get 401 without reaching the stand; (4) `deploy/docker-compose.yml`: publish `${VC_STAND_PROXY_PORTS}` when set (empty default keeps today's compose), document in docs/kb/deploy.md and docs/kb/server-internals.md; tests: lease reuse/expiry/exhaustion, membership check, cookie isolation both directions, Host/Origin rewrite, WebSocket upgrade and SSE through a fake agent tunnel, 401 without session. Gate: `npm run gate:task -- --base <sha>`. |
| B03 | Kanban | — | Live mode on a conversation working copy for Make stands, per docs/plans/make-stand-v1.md «Общий контракт» (copy of the plan is in this repository): in `apps/server/src/environments/liveWorkingCopy.ts` and `devStands.ts` accept a `workingCopyPath` that is a git worktree (a `.git` file pointing into the project repository) inside the project machine's `path` or `reposRoot`, whose `origin` is the registry repository; before starting `npm run dev:component` in the working copy install dependencies there with `npm ci --prefer-offline` when `node_modules` is missing or the `package-lock.json` hash differs from the last install recorded for that path (keep the record next to the stand state), report install failures as a failed operation with the npm tail; include `branch` (or null when detached) and `head` sha of the working copy in `live[]` of `GET /api/projects/:id/dev-stands/:standId`; add `GET /api/projects/:id/dev-stands/bases` → `[{ environmentId, name, machineId, ready, reason? }]` for managed environments (member access) so callers can tell which machine can host a new stand; tests for worktree acceptance and rejection (outside path, wrong origin), install skip/run decisions, live entry fields and the bases list. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
| C01 | Core | B01, B02 | Implement `makeStand` for Make in Core per docs/plans/make-stand-v1.md (requires make-contracts 1.7.0 pinned by the integrator): in `apps/server/src/makeBridge/projectAdapters.ts` (wired in `server.ts` and `makeBridge/coreRpc.ts`/`localCore.ts` like `standPreview`): conversation owner check and conversation project lookup (`db.chat.makeConversationProject`); `options`: repository of the conversation project → DevComponentId by `DEV_COMPONENT_REGISTRY` repository match, stands from Kanban of the conversation project and of every other project of the user whose stands include that component (stand host project), with machine names and live branch; machines of the conversation project with `canCreate` only when the host project has a managed, ready environment with `machines[0] === agentId` (reason otherwise); `create`: Kanban `POST /api/projects/:host/dev-stands` with that environment; `attach`: on the stand machine via agent exec (argv, no shell interpolation) `git fetch origin` in the project working copy, `git worktree add` of `<projectWorkdir>/../make-worktrees/<conversationId>` with the new branch from `origin/<baseBranch or project ciBaseBranch>` or the existing branch (reuse an existing worktree of the conversation, refuse `branch_exists` for a taken new name), then Kanban live on for the component with that `workingCopyPath`, phases reported in `MakeStandState`; `status`/`detach` via Kanban stand details and live off; `files`: agent fs ops strictly inside the conversation working copy (realpath containment, no symlink escape, 2 MiB limit); `git`: status/branches/pull/commit/push/branch on that working copy reusing the projectGit runtime with a workspace rooted at the working copy; `previewUrl` from `POST /api/dev-stand-access` logic of B02 when enabled (call the lease service directly; null when disabled), `directUrls` from the stand gateway urls; fix `standPreview` stand creation to use the same ready-environment rule; map Kanban/agent errors to the contract error codes; tests with fake Kanban and fake agent for every op, cross-project stand discovery, containment, error mapping. Update docs/kb/server-internals.md. Gate: `npm run gate:task -- --base <sha>`. |
| C02 | Make | B01 | Stand mode in Make per docs/plans/make-stand-v1.md (requires make-contracts 1.7.0 from B01 in this repository): (1) Make service: per-conversation stand binding (`standId`, `hostProjectId`, `machineId`, `component`, `branch`) stored in the conversation workshop metadata, routes `GET/POST /api/make/:conversationId/stand` calling `MakeCore.makeStand` with the conversation user; (2) UI in `packages/make-app` (`MakePane.tsx` preview header, replacing the free-text `MakeProjectStand` stand field): a «Стенд» selector shown when the conversation has a project — «Превью Make» (default), existing stands (host project, machine, status, current branch of the component), «Новый стенд на машине…» listing project machines with disabled reasons; after choosing a stand a branch step (new branch name prefilled `make/<slug>-<id8>` from the project base branch, or pick an existing branch), «Подключить» with phase progress (preparing/installing/switching), errors with the contract codes in Russian; when ready the preview iframe shows `previewUrl` (fallback: `directUrls` as links when it is null), «Открыть в новой вкладке», «Отключить стенд», status polling every 3 s while not ready; (3) Code tab in stand mode: file tree and editor over `makeStand files` of the conversation working copy, save writes through and HMR updates the stand; commit/push buttons via `makeStand git`; (4) assistant: when the conversation is bound to a ready stand, the `mcp__make__*` file tools (list/read/write/edit/delete/rename/apply_changes) operate on the stand working copy through `MakeCore.makeStand files` instead of the workshop, `make_check` returns the working copy git status, the git tools target the working copy, and the system hint states the stand mode, component and branch; workshop behaviour is unchanged otherwise; tests: binding persistence, route authorization, UI states (DOM tests for selector, branch step, phases, fallback links), file tools routing in stand mode vs workshop mode with a fake `MakeCore`. Update docs/kb/project-mode.md. Gate: `npm run gate:task -- --base <sha>`. |
