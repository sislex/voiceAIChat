---
title: Проекты и канбан-доска
updated: 2026-07-30

checked: f2b04f0
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
`hidden`), не удаляя задачи, и задать ей WIP-лимит (`wipLimit`, перебор
подсвечивается). У задач, помимо иерархии и приоритета, — атрибуты в духе Jira:
метки (`labels`), стори-поинты, срок (`dueDate`), флаг «внимание» (`flagged`) и
сквозной номер в проекте (`seq`) — из него UI строит ключ вида `PRJ-42`
(счётчик `projects.task_seq`, номера удалённых задач не переиспользуются).

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
детали), доска в стиле Jira — изолированный компонент `components/kanban/`:
`KanbanBoard` (самодостаточный, только пропсы: панель фильтров с чекбоксом
«скрытые», свимлейны, WIP-лимиты, композер «+ Создать», состояние `error`,
нормализация битых данных в `normalize.ts`), `TaskCard`, `TaskModal`,
атрибутика в `kanbanMeta.tsx`; страничная обёртка — `ProjectBoard`
(ToolFrame + настройки + Esc). Сториз — `*.stories.tsx` рядом
(`npm run -w @voicechat/ui storybook`). Перетаскивание — нативный HTML5 DnD:
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


## Epic / Story / Task

Новые проекты получают шесть системных колонок: «Бэклог», «Готово к разработке»,
«Разработка», «Тестирование», «Ожидает merge», «Готово». Их машинный смысл хранит
`semantic_type`, поэтому пользовательские подписи не участвуют в автоматизации.
Задачи образуют иерархию Epic → Story → Task. В быстрой форме доски для Story
обязательно выбирается родительский Epic; без него UI не отправляет запрос.
Выполнение задачи — CI-раннер, см. [features/ci-runner.md](features/ci-runner.md).

Для пула рабочих копий CI используется отдельное `project_machines.repos_root`
(бывший `feature_repos_root`); `project_machines.path` по-прежнему задаёт
директорию обычного проектного чата.

## Навыки по умолчанию, навыки карточки и связанный чат

В настройках проекта (`ProjectSettings`) владелец задаёт **навыки по умолчанию**
отдельно для Эпиков, Стори и Тасков — `projects.default_skills_{epic,story,task}`
(JSON-массивы), в домене `ProjectSummary.defaultSkills`. При создании элемента
(`createTask`) навыки его типа копируются в карточку — колонка `tasks.skills`
(`Task.skills`); если навыки переданы явно, они перекрывают дефолт. В карточке
(`TaskModal`) навыки правятся как метки: авто-добавленные можно убрать, свои —
дописать (`updateTask({ skills })`). На карточке (`TaskCard`) и в модалке навыки
показываются зелёными чипами (`.jcard-skill`).

Каждая карточка умеет открыть **связанный чат** (кнопка «💬» на карточке и
«Открыть/Создать чат» в модалке). `openOrCreateTaskChat(userId, projectId, taskId)`
идемпотентен по (пользователь, задача): находит чат текущего юзера с
`conversations.task_id = taskId` или создаёт новый, привязанный к задаче и её
проекту (машина/папка — дефолт проекта, навыки чата = `Task.skills`). Чаты приватны
на пользователя, поэтому у каждого участника — свой связанный чат. `getBoard`
подтягивает `Task.chatId` (id чата текущего юзера) корр. подзапросом. REST —
`POST /api/projects/:id/tasks/:taskId/chat` (`tasks:openChat`); стор-экшен
`openTaskChat` открывает чат и (в `App`) уводит на страницу чата `navigate('/')`.

Чат к **таску** создаётся автоматически при первом открытии карточки:
`TaskModal` зовёт `ensureTaskChat` (тот же идемпотентный `tasks:openChat`, но без
перехода на чат). У эпиков и стори автосоздания нет — ранов у них не бывает.
`CiRunManager.start` тоже вызывает `openOrCreateTaskChat` и пишет
`ci_runs.conversation_id`: туда дублируются вопросы модели и уходит резюме
законченного рана (см. [features/ci-runner.md](features/ci-runner.md)).

Имя нового связанного чата — **«Задача &lt;заголовок карточки&gt;»**: в общем списке
чатов такой чат сразу отличим от обычного разговора. Переименовать его можно
как любой другой (`conversations:rename`), и переименование ничем не блокируется —
заголовок задачи с ним больше не связан. Чаты, созданные до префикса, `migrate()`
переименовывает один раз и только если имя всё ещё равно заголовку задачи
(значит, пользователь его не менял).

Чат задачи знает свой контекст с двух сторон. Для модели — блок
«## Контекст задачи» в промпте хода (`turns.ts`, рядом с контекстом проекта):
иерархия, критерии приёмки, этап воркфлоу, машина, рабочая папка, режим
последнего рана. Для пользователя — шапка `components/chat/TaskChatHeader.tsx`
над лентой сообщений: крошки Проект/Эпик/Стори/Задача, лозенг этапа, режим и
статус рана, живой таймер работы, машина и папка, «Открыть задачу»
(`#/projects/:id/task/:taskId` → `ProjectBoard initialOpenTaskId`) и разворот в
ленту рана (`RunFeed`) по клику. Источник — `GET /api/conversations/:id/task-context`
(`db.getTaskChatContext`, канал `conversations:taskContext`), в сторе —
`taskChatContext`. Ключи задач (`issueKey`/`projectKey`) переехали из
`kanbanMeta.tsx` в `packages/shared/src/projects.ts`, потому что их считает и сервер.

В модалке задачи, помимо `CiTaskSettings`, есть панель CI-рана (статус, фаза,
«Выполнить», «Лента рана» / «Ответить модели»), а боковая колонка `.jmodal-side`
и `.jmodal-main` скроллятся независимо: модалка живёт в `.ccobs`
(`height: 88vh; overflow: hidden`), а `ToolFrame` не рендерит `.ccobs-body`.

Оформление доски и настроек выровнено под дизайн-систему Jira (Atlassian): палитра
`#0052CC`/`#0C66E4`, нейтрали `#626f86`/`#f7f8f9`, шрифтовой стек Atlassian,
капс-подписи полей в настройках.
