---
title: Feature Run — выполнение задач агентом в изолированных Git-workspace
updated: 2026-07-28
checked: 0cc0cbd
areas:
  - packages/shared/src/features.ts
  - packages/shared/src/projects.ts
  - packages/shared/src/ipc.ts
  - packages/shared/src/protocol.ts
  - apps/server/src/features
  - apps/server/src/routes/features.ts
  - apps/server/src/routes/projects.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/db/database.ts
  - packages/ui/src/components/FeatureDetail.tsx
  - packages/ui/src/components/ProjectBoard.tsx
  - packages/ui/src/components/TaskCard.tsx
  - packages/ui/src/components/VoiceBar.tsx
  - packages/ui/src/store/voiceStore.ts
symbols:
  - FeatureCoordinator
  - AgentWorkspaceExecutor
  - GitHubPullRequestService
  - FeatureRun
  - AgentTask
protocols:
  - feature-rest-v1
aliases:
  - feature
  - feature run
  - агентская задача
  - VoiceAIChatRepos
---

# Feature Run

Feature Run — попытка реализовать канбан-Task в отдельной Git-ветке и отдельной
рабочей копии. Одна Task хранит историю нескольких попыток, но одновременно у неё
может быть только одна активная Feature. Запуск из Story атомарно создаёт дочернюю
Task и Feature. Один Feature Run связан с одним разговором, поэтому внутри попытки
работает один активный агент. При создании в разговор сохраняется видимое стартовое
сообщение с названием, описанием и критериями Task. После подготовки workspace
`FeatureCoordinator` запускает это сообщение через процесс-глобальный `TurnManager`:
прогресс, токены, ответ и дальнейшие реплики работают как в обычном чате.

## Иерархия и канбан

`tasks.type` задаёт `epic | story | task`, `parent_id` — иерархию Epic → Story →
Task. UI показывает родительские карточки с раскрываемыми дочерними элементами.
Статус Task по-прежнему задаётся колонкой; системный смысл хранится отдельно в
`kanban_columns.semantic_type`: `backlog`, `ready`, `development`, `testing`,
`awaiting_merge`, `done`. FeatureCoordinator передвигает исходную Task при переходах
Feature, а родительские Story/Epic агрегируются. Отмена возвращает Task в `ready`.

## Workspace и ветка

У машины проекта два независимых пути. `project_machines.path` остаётся рабочей
директорией обычных чатов. `project_machines.feature_repos_root` — корень пула
`VoiceAIChatRepos`. `reserveRepositorySlot` атомарно берёт `available` слот либо
создаёт новый путь внутри корня. Перед использованием `AgentWorkspaceExecutor`
проверяет границу корня, remote origin, чистый worktree и отсутствие незавершённого
merge/rebase; затем обновляет base и создаёт `feature/<id>-<slug>`.

Успешный merge удаляет локальную feature-ветку и возвращает слот на base-ветку.
Отмена намеренно сохраняет ветку и изменения, переводит слот в `blocked` и требует
ручного решения. Ошибки подготовки/очистки переводят слот в `repair_required`,
чтобы повреждённая копия не переиспользовалась.

## Жизненный цикл

Общий автомат `packages/shared/src/features.ts` валидирует переходы:
`preparing → planning → awaiting_plan_approval/development → awaiting_commit →
testing → awaiting_merge → merging → completed`; тестовые ошибки возвращают в
`development`, терминалы — `completed`, `cancelled`, `failed`. Любой `failed`
возвращает исходную Task в системную колонку `ready`; карточка сохраняет ссылку на
неудачную попытку и предлагает запустить следующую. План подтверждается
вручную или автоматически по настройке проекта. Политика коммитов и способ merge
снимаются в Feature при создании, чтобы изменение настроек проекта не меняло уже
идущую попытку.

Для local merge используется обычный merge commit (`--no-ff`), тест после
интеграции и push base-ветки. В режиме GitHub Pull Request сервер пушит feature-
ветку, создаёт/переиспользует PR и вызывает GitHub API с `merge_method=merge`.
Токен берётся из `VC_GITHUB_TOKEN`.

## Production-деплой

После merge Feature остаётся `completed`, а деплой ведёт отдельный `deployStatus`
и историю `feature_deployments`. Ручной или автоматический запуск получает
актуальный `origin/main`, фиксирует его SHA в записи запуска, checkout делает
именно этого SHA и выполняет доверенную `productionDeployCommand` проекта. После
успеха workspace возвращается на base-ветку. Команды теста и деплоя задаёт только
владелец проекта; это намеренно доверенная конфигурация, не пользовательский ввод
в момент запуска.

## Жизненный цикл связанного чата

Пока Feature имеет активный статус, её разговор нельзя удалить: `deleteConversation`
проверяет связь и REST возвращает `409` с предложением сначала завершить или отменить
Feature. Это сохраняет канал управления агентом и не оставляет занятый workspace без
доступного чата. Для `completed`, `cancelled` и `failed` удаление разрешено;
внешний ключ ставит `features.conversation_id` в `NULL`, не удаляя историю попытки.

## Контракт и UI

REST и IPC перечислены в `packages/shared/src/protocol.ts` и `ipc.ts`: создание из
Task/Story, список и деталь Feature, настройки автомержа/автодеплоя, переходы,
Agent Tasks и история деплоев. Изменения входят в существующий `board.update` как
краткие Feature-сводки. `ProjectBoard` запускает/открывает попытку,
`FeatureDetail` показывает её автомат и Agent Tasks, а `VoiceBar` содержит
переключатели «Авто merge» и «Авто prod» активной Feature.

## Проверка

Контрактный автомат: `packages/shared/src/features.test.ts`. База и канбан:
`apps/server/src/db/database.projects.test.ts`. Git и coordinator:
`apps/server/src/features/*.test.ts`. HTTP: `apps/server/src/routes/features.test.ts`.
Полный гейт: `npm run typecheck && npm run test && npm run build`.
