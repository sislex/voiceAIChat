# make-stand-stories-v1 — истории (Storybook) проекта и подпроектов на стенде из Make

Ран `make-stand-stories-v1`. Ветка задач — `dev`. Продолжение [make-stand-v1](make-stand-v1.md).

## Запрос владельца (2026-10-10)

Беседа Make подключена к стенду разработки (ветка беседы, живой режим компонента). Нужно запускать
истории (Storybook) проекта и его подпроектов прямо на стенде: список историй, запуск и остановка
Storybook в рабочей копии беседы, кадр с историей в Make. Правки из редактора Make и от ассистента
должны попадать в истории с горячим обновлением.

## Что есть сейчас (origin/dev, 2026-10-10)

- Ядро: истории и Storybook работают через git-workspace (`/api/projects/:id/components`,
  `…/components/stories`, `…/components/storybook`, `…/components/storybook/open`,
  `apps/server/src/routes/projectComponents.ts`). Рабочая копия задаётся идентификатором
  `GitWorkspaceIdRef` (`ws:`, `repo:`, `chat:`, `project:` — `packages/shared/src/gitWorkspace.ts`,
  разбор в `GitWorkspaceService.resolve`). `StorybookSessions` (`apps/server/src/components/
  storybookSessions.ts`) запускает `npm run storybook --port <6006+> --no-open --ci` в каталоге копии
  через агента машины, индекс берёт с `/index.json`. Кадр: `storybook/open` отдаёт `direct`
  (та же машина), `tunnel` (локальный агент) или `proxy` (`/api/preview?url=…` через мост машины —
  медленно, без HMR).
- Рабочая копия беседы на стенде (`<reposRoot хозяина>/make-worktrees/<conversationId>`) не
  зарегистрирована как git-workspace: Storybook в ней запустить нельзя. Вкладка «Repository» в Make
  работает только с общей копией проекта на машине (`project:<agentId>`) и скрыта в режиме стенда.
- Прокси стенда на проде (`apps/server/src/standProxy.ts`, `POST /api/dev-stand-access
  {projectId, standId}`) выдаёт порт того же хоста только на шлюз стенда (`gatewayPort`); WebSocket
  и SSE через него проходят.
- Make: `MakeProjectStand.tsx` в режиме стенда показывает вкладки «Preview» и «Code»;
  `MakeProjectComponents.tsx` (вкладка «Repository» обычного режима) умеет список компонентов,
  запуск/остановку Storybook и кадр, но выбирает рабочую копию сама из `projects:gitWorkspaces`.
- У Core UI один Storybook (`packages/ui/.storybook`), он собирает истории подпроектов
  (`packages/admin-app`, `chat-app`, `operations-app`, …) — отдельных Storybook'ов у подпроектов нет.

## Решения

- **Рабочая копия беседы на стенде — git-workspace** `stand:<conversationId>/<hostProjectId>/<standId>`
  (новый вариант `GitWorkspaceIdRef` `{ kind: 'make-stand', conversationId, hostProjectId, standId }`).
  Ядро остаётся без состояния: ссылку на копию оно собирает из беседы и деталей стенда в Kanban.
  Все существующие маршруты `components*` работают с этим идентификатором без изменений контракта.
- **Кто и как.** Пользователь — владелец беседы; проект маршрута (`:id`) — проект беседы. Стенд
  читается из Kanban от имени пользователя (`GET /api/projects/<hostProjectId>/dev-stands/<standId>`):
  машина — `machineId` стенда, каталог — `workingCopyPath` записи `live[]` компонента, чей репозиторий
  совпадает с репозиторием проекта беседы. Нет такой записи — `409 stand_not_live`.
- **Кадр на проде — через прокси стенда.** `POST /api/dev-stand-access` принимает необязательный
  `port` (1024–65535): аренда на порт Storybook на машине стенда, ключ аренды — пользователь, проект,
  стенд и порт. `storybook/open` для `make-stand` при включённом прокси возвращает
  `{ kind: 'proxy', url: <адрес аренды> }` (тот же хост → HMR по WebSocket работает), иначе — как
  сегодня (`/api/preview?url=…`). Без прокси (`VC_STAND_PROXY_PORTS` пуст) кадр идёт через мост.
- **Make.** В режиме стенда третья вкладка «Stories» (доступна при `phase: 'ready'`): список историй
  проекта и подпроектов, сгруппированных по пакету (первые два сегмента пути файла истории:
  `packages/admin-app`, `apps/…`), кнопки запустить/остановить/перезапустить Storybook, кадр с
  историей. Один Storybook на рабочую копию; подпроекты — группы одного списка. Сохранение файла в
  «Code» и правки ассистента не требуют действий: Storybook в копии беседы подхватывает их сам;
  список историй перечитывается после сохранения `*.stories.*`.
- Storybook рабочей копии беседы живёт отдельно от Storybook общей копии проекта на той же машине
  (другой `workspaceId`, свой порт из `6006+`).

## Общий контракт (для всех задач)

- Идентификатор рабочей копии: `stand:<conversationId>/<hostProjectId>/<standId>` (три UUID через
  `/`); `buildGitWorkspaceId`/`parseGitWorkspaceId` в `@voicechat/shared`.
- Маршруты ядра (без изменений сигнатур): `GET /api/projects/<conversationProjectId>/components?workspace=…`,
  `GET …/components/stories?workspace=…&path=…`, `GET|POST …/components/storybook` (`action`:
  `start | stop | restart`), `POST …/components/storybook/open {workspace, localAgentId?}` →
  `ProjectStorybookAccess { kind: 'direct' | 'tunnel' | 'proxy', url, tunnelId, note }`,
  `DELETE …/components/storybook/tunnels/:tunnelId?workspace=…`.
- Ошибки резолвера (`GitError`): `404 workspace_not_found` (беседа чужая, проект не совпадает, стенда
  нет), `409 stand_not_live` (компонент не в живом режиме на копии беседы), `409 machine_offline`.
- `DevStandAccessRequest { projectId, standId, port?: number }`; ответ прежний `{ url, expiresAt }`.

## Задачи интегратора (Claude, вне манифеста)

- Перед стартом положить копию этого плана в `docs/plans/` репозитория Make.
- Финал: выпуск Make, закрепление в Core, релиз ядра и деплой; проверка на проде: беседа «Проект 35»
  → стенд M2 подключён → «Stories» → запуск Storybook → список историй по пакетам → кадр истории
  → правка файла истории в «Code» видна в кадре без перезагрузки → остановка Storybook.

| B01 | Core | — | Make stand working copy as a git workspace for stories, per docs/plans/make-stand-stories-v1.md «Решения» and «Общий контракт»: (1) `packages/shared/src/gitWorkspace.ts`: new `GitWorkspaceIdRef` variant `{ kind: 'make-stand', conversationId, hostProjectId, standId }` with id `stand:<conversationId>/<hostProjectId>/<standId>` in `parseGitWorkspaceId`/`buildGitWorkspaceId` (reject malformed values), tests; (2) `apps/server/src/git/workspaceService.ts`: `refFromMakeStand` — the conversation must belong to the user and to the route project (`db.chat.getConversation` + `db.chat.makeConversationProject` as in `makeBridge/projectAdapters.ts`), read the stand from Kanban on behalf of the user through the same Kanban client the Make adapters use, take `machineId` and the `live[]` entry whose component repository (`DEV_COMPONENT_REGISTRY`) equals the conversation project's repository, path = its `workingCopyPath`, else `GitError(409, 'stand_not_live')`; `online`/`writable` from the machine access of the conversation project, falling back to the host project; `kind: 'project-worktree'`, `conversationId` set, `expectedBranch` = live `branch`; map Kanban 404 to `workspace_not_found`; (3) `apps/server/src/standProxy.ts` + `packages/shared/src/devStandAccess.ts`: optional `port` (integer 1024–65535) in `POST /api/dev-stand-access`; a lease keyed by user+project+stand+port targeting that port on the stand machine instead of the gateway port (cookie renaming and header rewriting unchanged); (4) `apps/server/src/routes/projectComponents.ts` `storybook/open`: for `make-stand` workspaces when the stand proxy is enabled return `{ kind: 'proxy', url: <lease url>, tunnelId: null, note }` using the lease for the Storybook port of the stand (the service reference, not an HTTP call), otherwise the existing bridge proxy; keep `direct`/`tunnel` behaviour for other kinds; (5) tests: id parsing, resolver with a fake Kanban and fake conversation (owner mismatch, project mismatch, no live entry, happy path), lease with port, `storybook/open` for a stand workspace with proxy enabled and disabled; docs/kb/server-internals.md and docs/kb/deploy.md updated. Gate: `npm run gate:task -- --base <sha>`. |
| B02 | Make | — | Stories tab in Make stand mode, per docs/plans/make-stand-stories-v1.md (copy of the plan is in this repository): (1) `packages/make-app/src/components/MakeProjectStand.tsx`: a third tab «Stories» next to «Preview» and «Code», enabled only when `state.phase === 'ready'`; it renders the stories view for the fixed workspace id `stand:<conversationId>/<hostProjectId>/<standId>` of the bound stand with the conversation project id, receiving from `MakePane` the renderer api subset (`projects:components`, `projects:componentStories`, `projects:storybookSession`, `projects:storybookAction`, `projects:storybookOpen`, `projects:storybookCloseTunnel`), `localAgentId` and `ensurePreview` (add the needed props to `MakeProjectStand`, pass them from `MakePane`); (2) `MakeProjectComponents.tsx`: accept an optional fixed `workspaceId` (hides the working-copy picker and skips `projects:gitWorkspaces`), group the component list by package — the first two path segments of the story file (`packages/admin-app`, `apps/chat`), collapsible groups with counts, a filter box; start/stop/restart Storybook buttons and the story frame as today; frame `note` shown as a hint; (3) refresh: when the Code tab saves a `*.stories.*` file or the assistant turn in stand mode writes one, reload the stories list; the frame itself is left to Storybook HMR; (4) i18n messages in `packages/make-app/src/i18n/messages.ts` for all locales; (5) DOM tests: tab visibility by phase, fixed workspace id passed to the api, grouping by package, start/stop actions, list reload after a stories file save, with a fake api; docs/kb/project-mode.md updated. Gate: `npm run gate:task -- --base <sha>`. |
