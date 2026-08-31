---
title: Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач
updated: 2026-08-31
checked: 491eaaa7
areas:
  - packages/shared/src/widgetAssistant.ts
  - packages/shared/src/kanbanSimilarity.ts
  - packages/shared/src/orchestration.ts
  - packages/shared/src/llm.ts
  - packages/shared/src/protocol.ts
  - packages/shared/src/ipc.ts
  - apps/server/src/mcp/kanbanMcp.ts
  - apps/server/src/mcp/widgetUiRelay.ts
  - apps/server/src/mcp/widgetContext.ts
  - apps/server/src/orchestration/runManager.ts
  - apps/server/src/routes/projects.ts
  - apps/server/src/routes/rest.ts
  - apps/server/src/session.ts
  - apps/server/src/server.ts
  - apps/server/src/turns.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/db/database.ts
  - packages/ui/src/App.tsx
  - packages/ui/src/components/KanbanAssistant.tsx
  - packages/ui/src/lib/widgetUiActions.ts
  - packages/ui/src/remote/index.ts
---

# Канбан-ассистент

Ассистент страницы проекта работает так же, как ассистенты Make и Консоли:
инструментами в цикле, а не JSON-предложениями. Прежний envelope `propose.*`
(см. [projects.md](../projects.md#универсальный-ассистент-виджета)) остался
запасным путём и включается сам, если инструменты не подняты.

## Что видит ассистент: снимок экрана

`WidgetAssistantContext.surface` (`@shared/widgetAssistant`) — адрес
(`route`), раздел страницы (`board | settings | releases | assistant`),
открытая карточка и её вкладка, вид доски и **список кнопок, которые можно
нажать прямо сейчас**: пункты реестра командной палитры (`lib/commands.ts`),
у которых `enabled()` не вернул false. Снимок собирает `App.tsx` рядом с
`kanbanAssistantContext` и пересчитывает при смене маршрута, карточки, вида
доски и состава реестра (`useCommandsRevision`).

Рамка `WidgetAssistantFrame` поднята на уровень `ProjectPage`: ассистент виден
и в «Настройках», и в «Релизах», иначе «что сейчас открыто» для него всегда
было бы «доска».

Снимок доезжает до инструментов через `WidgetContextStore`
(`apps/server/src/mcp/widgetContext.ts`): `turns.ts` кладёт `assistantContext`
хода по `conversationId`, а UI-мост перезаписывает `surface` после собственной
навигации ассистента. Хранилище процессное, на разговор — одна запись.

## Инструменты `mcp__kanban__*`

Ход получает `kanbanMcpUrl` (`turns.ts`, база `KANBAN_MCP_PATH` + `conv` +
`turn`, в режиме «План» — `&ro=1`), если это ход панели ассистента: приватный
чат `assistantKind: 'kanban'` **или** обычный чат проекта, выбранный в её
селекторе. Второй случай узнаётся по присланному `assistantContext` — его шлёт
только эта панель, у чата из сайдбара такого поля нет. Раннеры
подключают сервер `kanban` (`claudeCli.ts` — allow-list из `KANBAN_TOOLS`,
`codexCli.ts` — `mcp_servers.kanban.url`), текст поведения один на оба движка —
`KANBAN_ASSISTANT_HINT` в `@voicechat/shared/llm`.

`KANBAN_TOOLS` — единственный список имён: по нему строится allow-list, и
тест `kanbanMcp.test.ts` проверяет, что сервер зарегистрировал ровно их. Иначе
разрешённый инструмент тихо расходится с существующим.

Чтение: `kanban_context` (что открыто), `kanban_board`, `kanban_task_get`
(карточка + сводка CI/merge/preparation), `kanban_search_tasks`,
`kanban_find_similar`, `project_info`, `machines_load`, `project_api_get`.
Последний — обёртка над **белым списком** ключей (`PROJECT_READ_KEYS`:
участники, машины, колонки, вид доски, приглашения, CI-команды и настройки,
релизы, таймлайн задачи, её раны, репозитории, улучшения). URL из запроса и
произвольного HTTP у адаптера по-прежнему нет.

Запись: `kanban_task_create|update|move`, `kanban_column_create|update`,
`project_settings_update`. Все идут через те же `db.*`, что REST, поэтому права
проверяются одинаково. Перенос карточки дополнительно сверяется с
`canTransitionWorkflow(actor: 'user')`: у ассистента не может быть прав,
которых нет у человека на доске.

Запуск работ: `run_preparation_start` (уточнение постановки), `run_ci_start`
(`queue`/`parallel`), `run_ci_cancel`, `run_merge_start`, `run_qa_start`
(`component_qa | integration_tests | automated_qa`), `preview_start` (тестовое
окружение фичи: `start`, `rebuild`, `stop`, `seed`, `reset`, `health_check`).
Настройки инфраструктуры: `project_machine_update` (`link`/`unlink`/`default`),
`release_create_branch` и `release_deploy`. Релизные инструменты проверяют
`db.isProjectOwner` **до** доступности механизма: отказ по правам не должен
зависеть от того, настроены ли релизы в этом окружении. Правила «куда
выпускать» общие с REST — `apps/server/src/releases/targets.ts`.

Приглашений участников среди инструментов нет намеренно: это письмо живому
человеку от имени пользователя, с собственным rate-limit и ролевым гейтом, а
для ведения задач оно не нужно. Логика очередей, изоляции директорий и проверок готовности не
дублируется — инструменты зовут `KanbanRunLaunchers`, которые в `server.ts`
собраны из `CiRunManager`, `MergeRunManager` и QA-раннеров ровно так же, как
это делают REST-роуты. Ссылка ленивая (`runs: () => …`): менеджеры создаются
ниже по файлу, чем регистрируется MCP.

## Автономия и подтверждения

Режим живёт на разговоре: колонка `conversations.assistant_autonomy`
(`auto` по умолчанию), мост `kanbanAssistant:setAutonomy` → `POST
/api/conversations/:id/assistant-autonomy`, тумблер «Автопилот» в шапке
`KanbanAssistant`. Одна точка политики — `allowMutation` в `kanbanMcp.ts`:

- режим «План» (`ro=1`) запрещает любые изменения;
- в `auto` обычные изменения применяются сразу;
- в `confirm` любое изменение спрашивается у пользователя;
- **необратимое наружу спрашивается всегда**, в обоих режимах: настройки
  проекта, merge в основную ветку, запуск плана работ.

Подтверждение — не отдельный механизм, а действие UI-моста `confirm`: сервер
блокирует вызов инструмента (таймаут 5 минут против 15 секунд у остальных
действий), браузер показывает обычный `useConfirm` с расшифровкой «было →
стало» (`formatConfirmRows`), ответ возвращается инструменту как `confirmed`.

**Идемпотентность и аудит.** Каждый изменяющий инструмент обёрнут в `mutating`:
ключ `toolCallKey(conv, turn, tool, args)` не даёт повтору вызова завести
вторую такую же карточку или второй ран (модель повторяет вызов после таймаута
или обрыва потока), а каждый вызов пишется в runtime-log событием
`kanban.tool` — с инструментом, аргументами, режимом автономии и результатом.
Отказы не кэшируются: «нет» пользователя — не результат, а решение, и на
следующий раз он вправе согласиться.

## Мост в интерфейс пользователя

`WidgetUiRelay` (`apps/server/src/mcp/widgetUiRelay.ts`) устроен как
`PreviewActionRelay`: WS-кадр `widget.action` уходит всем клиентам
пользователя, отвечает `widget.result` тот, у кого открыт проект разговора;
релей ждёт первый успех, все отказы или таймаут. Подписку держит `session.ts`
(`deps.widgetUi`).

Клиентская часть — `runWidgetUiAction` (`packages/ui/src/lib/widgetUiActions.ts`),
вынесенная из `App.tsx`, чтобы набор действий проверялся тестом: `read-state`,
`navigate`, `run-command`, `open-task`, `close-task`, `confirm`. Снимок экрана
возвращается **после** перерисовки (пауза 60 мс) — иначе на `navigate`
ассистент получил бы адрес «до перехода».

Границы: `ui_navigate` пропускает только `isAllowedWidgetRoute` — свой проект
(`/projects/<id>…`) и общую базу знаний (`/kb`); `/projects/p10` не считается
префиксом `/projects/p1`. `ui_run_command` работает только с id из реестра и
отказывает на выключенной команде — «нажать любую кнопку» реализовано через
реестр, а не поиском по DOM. Сверх того есть
`ASSISTANT_FORBIDDEN_COMMANDS` (сейчас `app.logout`): без него политика
подтверждений обходилась с чёрного хода — правка настроек спрашивается, а
выход из аккаунта одним нажатием нет. Список проверяется и на сервере, и в
браузере.

Частота ограничена: `WIDGET_UI_RATE_LIMIT` = 40 действий в минуту на разговор
(скользящее окно), иначе цикл `ui_navigate` дёргает экран быстрее, чем человек
успевает читать. Подтверждения в счёт не идут — их и так тормозит ответ
пользователя.

Экран может смениться внутри хода, поэтому клиент шлёт кадр `widget.surface`
при смене адреса, раздела или открытой карточки, а сервер обновляет им снимок
в `WidgetContextStore` (только для владельца разговора). Каждое выполненное
действие ассистента показывается тостом «Ассистент: …» — иначе страница
переключается «сама» и это читается как сбой.

## Анти-дубликаты

`rankSimilarTasks` (`@shared/kanbanSimilarity`) — чистая лексическая функция:
значимые слова без стоп-листа, совпадение в заголовке весит 3, в описании и
критериях 1, метки и навыки 2; результат нормирован в 0..1, порог
`STRONG_SIMILARITY = 0.4`. Она не решает за модель, а приносит кандидатов с
объяснением (`overlap`).

Слова сравниваются по основе (`wordStem`): без этого «корзина» и «корзину»
считались разными словами и дубликат спокойно проходил проверку. Полноценного
стеммера в пакете без зависимостей нет — окончание срезается, только пока
остаётся не меньше четырёх букв, а возвратный постфикс (`ся`/`сь`) снимается
отдельным проходом, иначе «сохраняются» не сходится с «сохраняется».

`taskPipelineState` в `kanbanMcp.ts` добавляет к кандидату место в конвейере по
семантике колонки и merge-ранам: `planned`, `in_progress`, `awaiting_merge`,
**`done_not_merged`** (карточка в `done`, но успешного merge-рана нет),
`merged`, `cancelled`. `BLOCKING_PIPELINE_STATES` — первые три из них: новую
пересекающуюся работу честнее начинать после merge.

`kanban_task_create` **сам** прогоняет этот поиск: при сильном пересечении он
не создаёт карточку, а возвращает `blockedBySimilar`. Модель обязана объяснить
разницу и повторить вызов с `acknowledgeSimilar: true` — это дешевле, чем две
ветки на одну правку.

## Балансировка машин

`machines_load` показывает онлайн, `activeRuns` из
`db.countActiveCiRunsByAgent()`, готовность и телеметрию, а рекомендацию даёт
тем же `pickCiRunAgent`, что и параллельные CI-раны
([ci-runner.md](ci-runner.md#параллельные-раны)) — иначе совет ассистента
расходился бы с реальным выбором машины.

## Оркестрация: план работ

План хранится в БД (`assistant_orchestrations` +
`assistant_orchestration_items`), а не в памяти хода: ожидание merge длиннее
любого ответа модели и обязано пережить закрытие вкладки и рестарт сервера.

Шаги: `create_task`, `run_ci`, `run_qa`, `run_merge`, `run_preview` и
`wait_merge`. Последний — не действие, а условие: он держит зависящие шаги,
пока ветка задачи не влита. Зависимости заданы позициями (`dependsOn`), задача наследуется по
цепочке от `create_task` (`inheritsTask` в shared, `taskOf` в менеджере).
`orchestrationPlanError` не принимает план с циклом, самозависимостью, ссылкой
в пустоту и шагом без задачи.

`createOrchestrationManager` (`apps/server/src/orchestration/runManager.ts`) —
идемпотентный tick (15 с) по образцу координатора автопрохода: дочитывает
состояние из БД, закрывает завершившиеся раны, запускает готовые шаги
**волнами** (после `create_task` зависящий `run_ci` стартует в том же проходе,
а не через тик) и останавливается, как только проход перестал что-либо менять.
`restore()` на старте сервера подхватывает планы со статусом `running`;
`track()` возвращает первый проход, поэтому `orchestration_start` отвечает
модели уже начатым планом.

Двигают план **события**, а не таймер: `boardHub.onChange` зовёт `notify()`, и
следующий шаг стартует сразу после завершения предыдущего рана. Таймер остался
страховкой на случай потерянного события, поэтому его интервал — минута.

Упавший шаг перезапускается, если автор плана заказал `retries` в его payload
(`orchestrationItemMaxAttempts`, максимум 3): счётчик живёт в колонке
`attempts`, шаг возвращается в `pending` и стартует заново. Исчерпав попытки,
он валит план. Итог любого плана уходит **сообщением в тот чат, откуда его
запустили** (`report` в `server.ts`): панель показывает идущие планы, а
результат нужен и через час. Одновременно у проекта не больше
`MAX_ACTIVE_ORCHESTRATIONS` = 3 планов.

Инструменты: `orchestration_plan` (проверить, не запуская), `orchestration_start`
(всегда с подтверждением), `orchestration_status`, `orchestration_cancel`.
Прогресс уходит в UI кадром `assistant.orchestration` (публикуется через
`ciRunManager.publish`, поэтому доезжает по уже существующей подписке), список
планов читается через `GET /api/projects/:id/orchestrations`, отмена —
`POST /api/orchestrations/:planId/cancel` (она же снимает таймер менеджера).
Панель прогресса живёт в шапке `KanbanAssistant`: идущие планы и последний
завершённый (до кнопки «Скрыть» — иначе итог серии исчезает ровно тогда, когда
стал интересен). Шаг с задачей — кнопка, открывающая карточку; у
перезапущенного шага видно номер попытки. Состояния панели есть в витрине —
`KanbanAssistant.stories.tsx`.
