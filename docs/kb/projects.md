---
title: Проекты и канбан-доска
updated: 2026-07-27
checked: 1479237
areas:
  - packages/shared/src/projects.ts
  - apps/server/src/routes/projects.ts
  - apps/server/src/projects
  - apps/server/src/db/schema.ts
  - apps/server/src/db/database.ts
  - packages/ui/src/components/ProjectsOverlay.tsx
  - packages/ui/src/components/ProjectBoard.tsx
  - packages/ui/src/components/TaskCard.tsx
  - packages/ui/src/store/voiceStore.ts
  - packages/ui/src/components/ConversationSettings.tsx
  - apps/server/src/turns.ts
---

# Проекты и канбан-доска

Отдельный режим web-клиента: пользователь ведёт **проекты**, внутри проекта —
канбан-доска задач. Первая многопользовательская сущность в проекте (в отличие от
разговоров/машин, которые принадлежат одному владельцу).

## Что это

У проекта: имя, описание, git-репозиторий, теги технологий и навыков (свободные
строки), список машин-агентов (id из реестра машин) и участники. Внутри —
колонки и задачи. **Колонка = статус задачи**: перемещение задачи между колонками
и есть смена статуса, отдельного поля статуса нет. Колонку можно скрыть (флаг
`hidden`), не удаляя задачи.

## Данные и доступ

Таблицы в `apps/server/src/db/schema.ts`: `projects`, `project_members`,
`project_machines`, `kanban_columns`, `tasks` (FK `ON DELETE CASCADE` к проекту;
задачи каскадят и от колонки). Технологии/навыки — JSON-массивы в колонке (как
`conversations.skill_names`). Порядок колонок и задач — дробный ранг (`position REAL`,
шаг 1024) с ренормализацией при схлопывании; см. методы в `database.ts`.

Доступ — по членству, а не по единственному владельцу: приватные гейты
`isProjectMember` / `isProjectOwner` (аналог `ownsConversation`). Любой участник
работает с доской/задачами/колонками; правка проекта, участники, машины и удаление —
только владелец (`role='owner'`; создатель садится владельцем в одной транзакции с
дефолтными колонками To Do / In Progress / Done). `assignee` задачи — только участник
проекта (валидируется на сервере). `deleteUserData` снимает членства, чистит
назначения и удаляет осиротевшие (без владельца) проекты.

## Контракт (REST + WS + мост)

Пути и типы — в `packages/shared/src/projects.ts` и `REST`/сообщениях
`packages/shared/src/protocol.ts`, IPC-каналы — в `packages/shared/src/ipc.ts`
(`projects:*`, `board:get`, `columns:*`, `tasks:*`). Роуты —
`apps/server/src/routes/projects.ts` (`registerProjectRoutes`, регистрируется в
`server.ts`); все под Bearer, не в `isPublic`. Клиент — каналы в
`packages/ui/src/remote/httpApi.ts`. Перемещение задачи (`tasks:move`) принимает
соседей `afterId`/`beforeId` (id, не индексы); сервер считает ранг в транзакции.

## Реалтайм (BoardHub)

Живые изменения доски рассылаются по WS: `apps/server/src/projects/boardHub.ts` —
процесс-глобальный эмиттер (`emit(projectId)` из REST-мутаций, `onChange` для сессий),
по образцу `AgentRegistry.onChange`. Per-connection подписка — в `session.ts`
(`board.subscribe`/`board.unsubscribe` → снапшот `board.update` только участникам).
Клиентский мост `window.board` (`RendererBoardBridge`) — только web; в desktop живой
синхронизации нет.

## Фронтенд

Всё в `packages/ui` (как и остальной UI). Состояние/экшены — в `voiceStore.ts`
(`projectsOpen`, `projects`, `projectDetail`, `activeProjectId`, `board`;
оптимистичные `moveTask`/`reorderColumns`, мерж `applyBoardUpdate` из WS). Экраны —
оверлеи через флаги стора (эталон — `UsersAdmin`): `ProjectsOverlay` (список +
детали), `ProjectBoard` + `TaskCard` (доска). Перетаскивание — нативный HTML5 DnD:
карточки (MIME `application/x-task`) и колонки (`application/x-column`) с раздельными
типами; вставка задачи — через drop-зоны между карточками. Кнопка «Проекты» — в
`Sidebar`.

## Что помнить

- Гейт как обычно: `npm run -w @voicechat/server typecheck && test` + тесты
  `ui`/`shared`. Тесты рядом: `db/database.projects.test.ts`,
  `routes/projects.test.ts`, `routes/projects.ws.test.ts`,
  `store/voiceStore.projects.test.ts`, `components/ProjectBoard.dom.test.tsx`.
- Машины проекта в v1 — только выбор/метадата (id агентов владельца); выполнение
  задач на них ещё не реализовано (изоляция агентов и `execTarget` не затрагиваются).

## Папка на машину, машина по умолчанию, связь с чатом (итерация 2)

У проекта на каждой машине — своя рабочая папка: `project_machines.path`
(`setProjectMachinePath`). Одна машина — по умолчанию: `projects.default_agent_id`
(`setProjectDefaultMachine`; снятие машины сбрасывает дефолт). `ProjectDetail` несёт
`machines: {agentId, path}[]` и `defaultAgentId`. Всё это правит владелец в
`ProjectsOverlay`.

Чат привязывается к проекту полем `conversations.project_id`
(`setConversationProject`, REST `POST /api/conversations/:id/project`, канал
`conversations:setProject`). При привязке сервер **перезаписывает** у чата машину
(=дефолт проекта), рабочую папку (=папка дефолт-машины) и навыки (=`skills` проекта).
В `ConversationSettings` появляется селектор «Проект»; при выбранном проекте список
машин фильтруется машинами проекта, дефолт — проектный, смена машины подставляет её
папку. Контекст проекта (git/технологии/навыки/описание) дописывается в промпт хода
в `turns.ts` (по образцу KB-инъекции), если чат привязан.

Кнопки сайдбара «проводник»/«консоль» открываются на ЭФФЕКТИВНОЙ машине и папке
активного чата (`openUtilityForActiveChat` → `execTarget`+`workdir`). Для чата с
проектом это уже проектные значения (перезаписаны при привязке). Проводник
открывает саму папку (`FileExplorer initialDir` / `ToolSpec.dir`), а не её родителя.

Проекты пока одновладельческие для выполнения: exec идёт только по своим машинам
(изоляция агентов не меняется).
