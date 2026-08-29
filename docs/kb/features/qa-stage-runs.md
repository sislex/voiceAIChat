---
title: Раны QA-этапов: отдельные сущности и вкладки карточки
updated: 2026-08-20
checked: 2ba06683
areas:
  - packages/shared/src/qa.ts
  - packages/shared/src/qa.test.ts
  - apps/server/src/ci/integrationTests.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/db/database.ts
  - apps/server/src/db/database.qa.test.ts
  - apps/server/src/routes/qa.ts
  - apps/server/src/server.ts
  - packages/ui/src/components/qa/QaStageRunPanel.tsx
  - packages/ui/src/components/kanban/TaskModal.tsx
  - packages/ui/src/components/kanban/TaskCard.tsx
  - packages/ui/src/components/kanban/KanbanBoard.tsx
  - packages/ui/src/components/kanban/KanbanBoard.dom.test.tsx
  - packages/ui/src/styles/app.css
  - packages/ui/src/remote/qaBridge.ts
---

# Раны QA-этапов: отдельные сущности и вкладки карточки

## Что это и чем отличается от соседних ранов

Три пост-development стадии workflow — «Component QA», «Создание интеграционных
тестов» и «Automated QA» — получили собственную сущность рана: таблицу
`qa_stage_runs`, типы в `packages/shared/src/qa.ts`, REST-набор в
`apps/server/src/routes/qa.ts` и панель `QaStageRunPanel` с отдельной вкладкой
карточки. Это ещё одна независимая линия ранов рядом с development (`ci_runs`),
подготовкой задачи (`task_preparation_runs`), подготовкой ручного QA
(`qa_preparation_runs`), автоматизированным Component QA (`component_qa_runs`),
ручными `qa_sessions` и merge-раном: общих таблиц, маршрутов и панелей у них
нет, а история выбирается по discriminator `stage`.

С появлением `integration_test_runs` эта сущность обслуживает исполнение только
одной стадии — `automated_qa`; для `component_qa` и `integration_tests` есть
специализированные таблицы и панели, а `qa_stage_runs` остаётся у них лишь
исторической записью, влияющей на видимость вкладок.

Важно не спутать `qa_stage_runs` с уже существующими `component_qa_runs`
(см. [manual-qa.md](manual-qa.md)) — это разные таблицы и разные API. Более
того, вкладка «Component QA» в карточке по-прежнему монтирует старую
`ComponentQaPanel` поверх `component_qa_runs`; `QaStageRunPanel` монтируется
только на вкладках «Интеграционные тесты» и «Automated QA». Записи
`qa_stage_runs` со `stage='component_qa'` создаются лишь через REST или в
тестах, но на видимость вкладки и автовыбор влияют.

## Исполнение Automated QA

Всё в этом разделе относится к `qa_stage_runs`. Стадия `integration_tests` из
этой границы вышла: у неё появились собственная таблица и runner — см.
«Предметный контур Integration Tests» ниже. Для `component_qa` используется специализированный `component_qa_runs`, а
`automated_qa` исполняет `createAutomatedQaRunner` поверх общего `CommandExecutor`.

`startQaStageRun` создаёт queued-попытку, после чего Automated QA runner берёт
`projects.automated_qa_command` (дефолт `npm test`), pushed development-workspace
и его машину. Команда исполняется с `CI=1` и общим 30-минутным бюджетом; stdout
потоково дописывается в `qa_stage_runs.log_json`. Exit code 0 завершает gate и
переводит задачу в `manual_qa`, ненулевой код, timeout или потеря исполнителя
сохраняют понятную ошибку. Активный Automated QA после рестарта возвращается в
`queued` и перезапускается с тем же id и сохранённым логом.

## Хранение

`qa_stage_runs` (`apps/server/src/db/schema.ts`, идемпотентный
`CREATE TABLE IF NOT EXISTS`; существующим карточкам миграция ничего не
досоздаёт) хранит `stage` с CHECK по трём значениям, статус, номер попытки,
инициатора, ветку и commit SHA, снимок LLM, текущий шаг, `progress_json`,
`log_json`, `result_json`, `gate_reasons_json`, ошибку и метки
`created_at/started_at/finished_at`; FK на проект и задачу с `ON DELETE CASCADE`.
Индекс `(task_id, stage, created_at DESC)` обслуживает историю, а partial unique
`(task_id, stage) WHERE status IN ('queued','running','awaiting_input')`
физически запрещает две активные попытки одного этапа у одной задачи.

Статусы — `queued | running | awaiting_input | success | gate_failed | failed |
cancelled | interrupted`. Флаги `canCancel` (активные три) и `canRetry`
(`gate_failed|failed|cancelled|interrupted`) не хранятся, а вычисляются в
`mapQaStageRun` при чтении. Типы `ComponentQaStageRun`, `IntegrationTestsRun`,
`AutomatedQaRun` различаются полем `kind`
(`componentQaRun|integrationTestsRun|automatedQaRun`, таблица `QA_RUN_KIND`),
объединение — `AnyQaStageRun`; список стадий `QA_RUN_STAGES` один и тот же на
сервере, в маршруте и в UI.

## Старт, идемпотентность и граница этапов

`startQaStageRun` (`apps/server/src/db/database.ts`) требует членство в проекте,
существующую задачу типа `task` и совпадение semantic type её текущей колонки с
запрашиваемым этапом — иначе `Этап <stage> нельзя запустить из колонки <...>`.
Это и есть реализованная граница «следующий этап нельзя запускать, пока не
пройден предыдущий»: она выражена положением карточки, отдельного признака
завершённости предыдущего этапа нет. Если активный ран этапа уже есть, метод
возвращает его же — повторный `POST` идемпотентен и нового рана не создаёт.
Номер попытки — `MAX(attempt)+1` в пределах пары `(task_id, stage)`, поэтому
нумерация у каждого этапа своя.

Ветка и SHA берутся из полей задачи `mergeSourceBranch`/`mergeSourceSha` (пустая
строка, если их нет), а не из CI-workspace, как у `component_qa_runs`. Прав
уровня QA старт не требует: проверяется только `isProjectMember`, тогда как
`startComponentQaRun` требует `canQa`.

`cancelQaStageRun` переводит активный ран в `cancelled` с текстом ошибки «Ран
отменён пользователем», для терминального рана просто возвращает его без
изменений. `retryQaStageRun` не воскрешает попытку, а вызывает
`startQaStageRun` для того же этапа — то есть создаёт следующую попытку и
подчиняется той же проверке колонки; для рана без `canRetry` бросает «Повтор
этого рана недоступен».

## Гейт и перенос карточки

`completeQaStageRun(userId, runId, result)` — единственная точка, где ран
завершается и карточка едет дальше. Для `integration_tests` гейт считает чистая
`canCompleteAutomation(testCases, run.commitSha)` из `packages/shared/src/qa.ts`:
у каждого обязательного автоматизируемого кейса должен быть `automationLink` с
текущим SHA и непустым путём, у каждого обязательного неавтоматизируемого —
непустые `notAutomatedReason` и `alternativeManualVerification`. Кейсы берутся из
переданного `result.testCases`, а не из сохранённых критериев задачи; если
обязательных кейсов в payload нет вовсе, гейт падает с
`missing_required_test_cases`. Для двух других этапов гейт проще: успех — это
`result.gatePassed === true`, иначе причины берутся из `result.gateReasons`,
а при их отсутствии подставляется `quality_gate_failed`.

В отличие от `completeComponentQaRun`, эта ветка не спрашивает
`canTransitionWorkflow`: допустимость перехода задана самой картой стадий.

Непройденный гейт даёт `status='gate_failed'` с сохранёнными причинами и
`current_step='gate'`, колонка не меняется. Пройденный гейт в одной
SQLite-транзакции ставит `success` и вызывает `moveTask` в следующую колонку по
карте `component_qa → integration_tests → automated_qa → manual_qa`, поэтому
состояния «карточка уехала, а рана нет» не возникает; отсутствие целевой
колонки — исключение до записи. Статусы `failed`, `cancelled` и `interrupted`
карточку не двигают.

## Восстановление после рестарта

`failInterruptedQaStageRuns` одним UPDATE закрывает все
`queued|running|awaiting_input` как `interrupted` с ошибкой «Ран прерван
перезапуском сервера» и возвращает список id; `buildServer`
(`apps/server/src/server.ts`) вызывает его рядом с аналогами для
preparation/QA-preparation/Component QA и пишет предупреждение в лог.
`interrupted` входит в `canRetry`, поэтому попытка не остаётся вечно running и
допускает повтор.

## REST

Маршруты регистрирует `registerQaRoutes`. Стадия в пути валидируется по
`QA_RUN_STAGES`, неизвестная даёт 404 `unknown QA stage`.

- `GET /api/projects/:projectId/tasks/:taskId/qa/runs/:stage` — история попыток
  этапа, `attempt DESC` (не член проекта получает пустой массив);
- `GET …/qa/runs/:stage/current` — последняя попытка или 404 `run not found`;
- `POST …/qa/runs/:stage` — идемпотентный старт, 202 с раном;
- `DELETE /api/qa/runs/:runId` — отмена;
- `POST /api/qa/runs/:runId/retry` — 202 со следующей попыткой;
- `POST /api/qa/runs/:runId/answer` — ответ на уточнение (только
  `integration_tests` в `awaiting_input`, пустой ответ отклоняется).

Отдельного маршрута «завершить ран/зачесть гейт» нет. WS-событий и подписки у
этих ранов тоже нет: ни `protocol.ts`, ни `ws.ts`, ни доменные хранилища UI о них не
знают, живость обеспечивает опрос панели. Клиентская сторона — опциональные
методы `listStageRuns`, `startStageRun`, `cancelStageRun`, `retryStageRun`,
`answerStageRun` в `RendererQaBridge` (`packages/ui/src/remote/qaBridge.ts`),
реализованные только REST-мостом `createQaRest`; без них панель не показывает
соответствующие кнопки.

## Вкладки карточки и панель

`TaskModal` держит вкладки локально. Между «Настройки» и «Ручное QA»
динамически вставляются «Component QA», «Интеграционные тесты», «Automated QA».
Вкладка видима, если по списку `workflowOrder` текущая колонка задачи не раньше
этапа либо по этапу есть сохранённая история ранов. `workflowOrder` — локальная
копия `QA_WORKFLOW` из `packages/shared/src/projects.ts`, объявленная прямо в
`TaskModal`, а не импорт: при правке канонического списка стадий её нужно
менять руками. При открытии карточки один эффект с зависимостью `[task.id]` параллельно
тянет историю всех трёх этапов; если у какого-то есть активная попытка,
активной становится его вкладка. Начальный выбор (`defaultTab`) для карточки в
QA-колонке — вкладка этой колонки, иначе прежнее правило «активный
development/merge → «Лента рана», иначе «Общее»». Поскольку и загрузка истории,
и сброс вкладки завязаны только на `task.id`, realtime-обновление того же таска
ручной выбор не сбрасывает. Индикатора состояния на самих вкладках
(активность/ожидание ответа/ошибка/непройденный гейт) нет — рисуются только
подписи. Общая техническая лента development/merge осталась отдельной вкладкой
«Лента рана».

`QaStageRunPanel` (`packages/ui/src/components/qa/QaStageRunPanel.tsx`) —
диспетчер: описанное ниже поведение относится к её ветке
`GenericQaStageRunPanel`, то есть теперь только к вкладке «Automated QA».
Панель монтируется на вкладку и делает только GET: открытие вкладки ран не запускает.
Пока верхний ран активен, панель опрашивает историю раз в 1,5 с — так живут
прогресс и лента после перезагрузки страницы. Показывает статус, попытку, ветку
и первые 10 символов SHA, текущий шаг с `progress current/total/label` и
`<progress>`, причины непройденного гейта, ошибку, `result` как JSON, потоковую
ленту по `log`, историю попыток и форму ответа модели для integration-рана в
`awaiting_input`. Действия — «Запустить» (когда активного рана нет),
«Отменить», «Повторить»; действий «Вернуть в Development», «Запросить решение»,
«Повторить с упавшего шага» и переходов к диагностике в панели нет.

На канбан-карточке (`TaskCard`) для колонок трёх QA-этапов запуск
development-рана скрыт (`developmentAllowed` теперь исключает эти колонки), а
вместо CI-панели показывается блок `task-qa-run-panel` с названием этапа и
кнопкой «Лента рана». Кнопка вызывает обычное `onOpen(task.id)`: карточка
открывается, а нужную вкладку выбирает `defaultTab` по колонке задачи.

## Предметный контур Integration Tests

Исполнение стадии `integration_tests` вынесено из `qa_stage_runs` в отдельную
таблицу `integration_test_runs` со своими маршрутами `…/qa/integration`, своим
runner'ом `apps/server/src/ci/integrationTests.ts` и своей веткой панели.
`qa_stage_runs` остаётся исторической моделью: её записи со
`stage='integration_tests'` продолжают влиять на видимость и автовыбор вкладки,
но панель этой вкладки показывает уже предметное состояние.

**Чего в коде нет.** LLM-этапа стадия не содержит: нового `CiRunMode` не
появилось (`packages/shared/src/ci.ts` — `plan | development`), ран не
запускает модель, не пишет тесты, не коммитит и не пушит. Он предполагает, что
тесты уже лежат в HEAD-коммите development-workspace, и проверяет/прогоняет
именно их. Соответственно нет и структурированного вывода `{testId,path}` от
модели: покрытие синтезируется из диффа (см. ниже).

**Модель и старт.** Ран хранит id успешного development-рана, ветку и SHA его
workspace, номер попытки, статус
(`queued|running|passed|failed|blocked|cancelled|stale|skipped`), id
readiness-рана и `snapshot_version`, снимок тест-кейсов, записанные
`automation_links`, `commands`, лог, классификацию отказа, `failure_reason`,
блокеры, сводку, `stale_reason` и `linked_fix_run_id`; `canCancel`
(queued/running) и `canRetry` (failed/blocked/cancelled/stale) вычисляются при
чтении. `startIntegrationTestRun` требует `canQa` и в одной транзакции
проверяет `semantic_type='integration_tests'`, pushed CI-workspace с
веткой/SHA/машиной/путём (`findLatestPushedCiWorkspace`), успешный
development-ран на этом workspace и успешный `task_preparation_runs` с
`readiness_json`. Нарушения не бросают ошибку, а сохраняются аудируемым
`blocked`-раном с точными причинами (`task_not_in_integration_tests`,
`missing_pushed_development_workspace`, `successful_development_run_not_found`,
`missing_readiness_snapshot`), карточка остаётся на месте. Если предусловия
целы, обязательных automatable-кейсов нет, а каждый обязательный
неавтоматизируемый кейс снабжён `notAutomatedReason` и
`alternativeManualVerification`, тем же вызовом создаётся `skipped`-ран и
`moveTask` в той же транзакции переводит карточку в `automated_qa` (после
`canTransitionWorkflow('integration_tests','automated_qa','automation')`) — без
отдельного вызова гейта.

**Устаревание считается до идемпотентности.** Два UPDATE в начале старта
помечают `stale` все нестарые раны задачи с другим `commit_sha`
(`sha_changed`) или другим `snapshot_version` (`snapshot_changed`) — включая
уже завершённые `passed`/`skipped`. Только после этого ищется активный
`queued|running` ран: если он уцелел, метод возвращает его же, и новый не
создаётся; если он был помечен stale — создаётся следующая попытка.
Фонового наблюдателя нет. `integrationTestSemanticVersion` — FNV-1a по
стабильно сериализованным **automatable**-кейсам (id, тексты, `required`,
`testType`), поэтому правка неавтоматизируемого кейса или самих
`automationLinks` версию не меняет.

**Исполнение.** `integrationTestExecutionContext` сам достаёт машину, путь и
`projects.test_command` джойном ран → development-ран → workspace, причём
только для рана в `queued` с `pushed=1` и `w.commit_sha = r.commit_sha`; иначе
runner закрывает ран как `blocked/infrastructure/workspace_unavailable`.
Команды разбирает общий `testStages` (дефолт стадии — `npm run
affected-check`, не Vitest-специфичный). Перед прогоном runner выполняет
`git diff-tree --no-commit-id --name-only -r HEAD` и прогоняет список через
`validateIntegrationTestDiff` (`qa.ts`): разрешены пути с сегментом
`__tests__|tests?|test|integration` и файлы `*.test.*`/`*.spec.*`. Любой другой
файл — немедленный `blocked` + `implementation_defect` +
`non_test_files_changed` и блокеры `non_test_file:<path>`. Затем `git rev-parse
HEAD` даёт SHA, и `recordIntegrationAutomationLinks` записывает ссылки. Стадии
идут последовательно через тот же `ciExecutor` с `CI=1`, общий бюджет 30 минут
делится между ними (каждая получает остаток), stdout всех стадий льётся в
единый `log` с обрезкой до 500 000 символов, на каждую стадию создаётся запись
`stage-N` с командой, exit code, длительностью, статусом и диагностикой. Первый
ненулевой код прерывает остальные: все нули → `passed`; ненулевой →
`failed/implementation_defect/non_zero_exit`; timeout или `exitCode == null` →
`blocked/infrastructure` с `command_timeout`/`executor_disconnected`; исключение
в промисе → `blocked/infrastructure/executor_error`. Отмена дергает
`AbortController` из карты живых ранов, после чего цикл выходит, не записывая
итог (статус уже проставил маршрут). `failInterruptedIntegrationTestRuns` в
`buildServer` закрывает все `queued|running` как
`blocked/infrastructure/server_restarted`.

**Как появляются `automationLinks`.** Per-case маппинга нет: runner берёт
первый прошедший валидацию путь из диффа и приписывает его **всем** обязательным
automatable-кейсам снимка. `recordIntegrationAutomationLinks` пишет их в три
места сразу — в канонический `task_preparation_runs.readiness_json` (заменяя
ссылки с тем же SHA), в сам ран (`commit_sha`, `test_cases_json`,
`automation_links_json`) и в `ci_workspaces.commit_sha` того workspace, откуда
взят development-ран. Последнее существенно: именно поэтому SHA рана и SHA
workspace после записи снова совпадают и гейт проходит. Известный дефект:
разбор вывода `git diff-tree` использует регулярку `/\\r?\\n/` с двойным
экранированием, то есть по строкам не режет — многофайловый дифф приходит в
валидацию одной склеенной строкой.

**Гейт.** `integrationTestGate(run, currentSha, currentCases)` (чистая функция в
`qa.ts`, причины дедуплицируются) требует статус `passed`/`skipped` без
`staleReason`, совпадение `commitSha` и `snapshotVersion` с текущими, `passed` и
exit 0 у каждой записанной команды, пустой список блокеров и в конце
безусловно добавляет причины существующей `canCompleteAutomation(currentCases,
currentSha)`. `completeIntegrationTestRun` повторяет этот гейт на сервере,
ещё раз сверяет колонку и `canTransitionWorkflow` и только затем двигает
карточку; кнопка UI источником истины не является.
`getIntegrationTestTaskState` считает тот же гейт для **последнего** рана и
отдаёт `launchReasons`/`gateReasons`/`canStart`/`canComplete`; при отсутствии
ранов — `integration_test_run_missing`.

**REST и мост.** `GET …/qa/integration` (404 для не-члена или неизвестной
задачи), `POST …/qa/integration/runs` (идемпотентный старт; 202 для
`queued|running`, 200 для `blocked`/`skipped`; `queued` тут же уходит в
runner), `…/runs/:runId/cancel`, `…/runs/:runId/complete`,
`…/runs/:runId/fix`. Fix доступен для `failed`/`blocked`, запускает один
development-ран через `CiRunManager.start` (он же переносит карточку в
`development`), кладёт в `fix_context_json` `stepId=integration_tests:<runId>`,
хвост из сводки, лога и команд (последние 50 000 символов) и список
обязательных automatable-кейсов без ссылки на текущем SHA, после чего
`linkIntegrationTestFixRun` сохраняет `linkedFixRunId`; повторный вызов
возвращает уже связанный `ci_run`. В отличие от Component QA сам
integration-ран при этом не переводится в `failed`. URL-хелперов в
`protocol.ts` для этой стадии нет — пути собраны строками в
`createQaRest`; методы `getIntegration`/`startIntegration`/`cancelIntegration`/
`completeIntegration`/`fixIntegration` в `RendererQaBridge` опциональны.

**Панель.** `QaStageRunPanel` стал диспетчером: для `stage='integration_tests'`
монтируется внутренний `IntegrationTestPanel`, для `automated_qa` — прежний
`GenericQaStageRunPanel` поверх `qa_stage_runs` (вкладка «Component QA»
по-прежнему монтирует `ComponentQaPanel`). Живёт панель на вкладке
«Интеграционные тесты», а не внутри «Ручного QA». Без `window.qa.getIntegration`
она печатает «Стадия недоступна». Показывает причины недоступности запуска,
ветку/SHA/попытку, блокеры, тест-кейсы с пометкой «автоматизируемый/исключён» и
ссылками на файлы тестов текущего SHA, команды с exit code и длительностью,
потоковый лог (раскрыт у running), сводку и историю попыток; действия —
«Запустить», «Отменить», «Повторить» (тот же `startIntegration`), «Отправить на
доработку», «Перейти к Automated QA» (активна только при `canComplete`). Пока
есть активный ран, состояние опрашивается раз в 2 секунды, а ответ старше
локального снимка (сравнение по `finishedAt`/`startedAt`/`createdAt`)
отбрасывается.

## Жизненный цикл и переходы

Специализированный Integration Tests запускается только явным `POST
…/qa/integration/runs` (в UI — действие панели), а не переносом или сортировкой
карточки. `startIntegrationTestRun` требует QA-право и сверяет системную колонку
`integration_tests`, актуальный pushed development-workspace с машиной, путём,
веткой и SHA, успешный development-ран и успешный readiness-снимок. Несоблюдение
предусловий создаёт аудируемый `blocked`-ран в `integration_test_runs`; живой
`queued|running` ран того же SHA и версии снимка переиспользуется. Если
обязательных automatable-кейсов нет, а исключённые обязательные кейсы полностью
обоснованы, старт сразу сохраняет `skipped` и транзакционно переносит задачу в
`automated_qa`.

Обычный Integration Tests ран исполняет последовательность команд в сохранённом
development-workspace, валидирует, что HEAD-дифф содержит только тестовые файлы,
записывает команды, общий лог, снимок кейсов и `automation_links` в
`integration_test_runs`, а ссылки также в readiness-снимок; код тестов остаётся
в workspace и ветке задачи. После `passed` автоматического переноса нет:
`completeIntegrationTestRun` по явному запросу повторно проверяет статус, команды,
блокеры, текущие SHA и semantic version, полноту automation links, текущую колонку
и разрешённость workflow-перехода, затем переводит задачу в `automated_qa`.
`failed|blocked|cancelled|stale` её не двигают и допускают повтор либо
development fix-run. Источники: `apps/server/src/db/database.ts`,
`apps/server/src/ci/integrationTests.ts`, `apps/server/src/routes/qa.ts`.

Automated QA запускается только явным `POST …/qa/runs/automated_qa` для задачи,
уже находящейся в системной колонке `automated_qa`; перенос, сортировка,
переименование колонки и открытие вкладки рана не создают. Повторный старт
возвращает существующий активный ран. Попытка хранится в `qa_stage_runs` со
`stage='automated_qa'`: там лежат статус и номер попытки, инициатор, ветка/SHA,
текущий шаг, progress, лог, result, причины gate, ошибка и временные метки.
Неуспешный gate, отмена и прерывание не меняют колонку; внутренний
`completeQaStageRun` при `result.gatePassed === true` транзакционно ставит
`success` и переводит карточку в `manual_qa`.

Automated QA исполняет реальную команду проекта через runner. Для карточки с
`autoPilot` серверный координатор автоматически запускает все QA-стадии,
пропускает `manual_qa`, если проект не требует ручного gate, и передаёт задачу
существующему merge-рану через `awaiting_merge`. Каждое действие пишется в
`qa_audit` с actor=`automation`. Ошибка создаёт связанную bug-задачу, возвращает
исходную в `development` и запускает fix-run; число кругов ограничено
`autopilot_fix_limit` (дефолт 3), затем используется `decision_required`.

## Справка об автоматизации на канбане

`KanbanBoard` показывает кнопку «i» по semantic type, а не по редактируемому
названию, только для шести стадий: `preparation`, `development`,
`component_qa`, `integration_tests`, `automated_qa`, `merge`. Диалог
описывает условия старта и отказа, этапы, результат, хранение и дальнейшее
использование. Кнопка гасит pointer-событие, поэтому не начинает перенос колонки;
диалог получает фокус на кнопке закрытия, закрывается этой кнопкой, Escape или
кликом по фону и возвращает фокус инициатору. На узких экранах он становится
нижней панелью с прокручиваемым телом. DOM-тесты фиксируют выбор по semantic type,
возврат фокуса, Escape и отсутствие reorder.

## Проверки

Сервер по `qa_stage_runs` покрыт двумя кейсами в
`apps/server/src/db/database.qa.test.ts`: независимость и идемпотентность
историй трёх этапов с переходами по гейту и восстановление прерванных ранов в
`interrupted`.

Integration tests добавили три db-кейса там же (общая фикстура
`integrationFixture` ставит карточку в `integration_tests` и подменяет
`readiness_json`): один активный ран и физическая идемпотентность повторного
старта, `skipped`-ветка с переездом в `automated_qa`, пометка предыдущего рана
`stale/sha_changed` после смены SHA workspace. В `packages/shared/src/qa.test.ts`
— два кейса: `validateIntegrationTestDiff` отсеивает нетестовые пути, и
`integrationTestGate` привязан к SHA и семантической версии, переиспользуя
`canCompleteAutomation`. UI — два DOM-теста `QaStageRunPanel.dom.test.tsx` (лог
и отмена активного рана; причины недоступности запуска плюс фолбэк «Стадия
недоступна»); прежние три теста generic-панели удалены вместе с ними.

Не покрыты: маршруты `…/qa/integration` (включая идемпотентность fix), проверка
диффа и классификация отказов внутри runner'а, `completeIntegrationTestRun` на
уровне БД, видимость и автовыбор вкладок в `TaskModal`, запрет второй активной
попытки на уровне БД. 12 сторис `QaStageRunPanel.stories.tsx` не обновлены: они
подставляют только `listStageRuns`, поэтому четыре стори стадии
`integration_tests` теперь рисуют фолбэк «Стадия недоступна».
