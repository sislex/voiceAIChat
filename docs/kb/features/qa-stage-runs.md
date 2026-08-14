---
title: Раны QA-этапов: отдельные сущности и вкладки карточки
updated: 2026-08-14
checked: a64b490
areas:
  - packages/shared/src/qa.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/db/database.ts
  - apps/server/src/db/database.qa.test.ts
  - apps/server/src/routes/qa.ts
  - apps/server/src/server.ts
  - packages/ui/src/components/qa/QaStageRunPanel.tsx
  - packages/ui/src/components/kanban/TaskModal.tsx
  - packages/ui/src/components/kanban/TaskCard.tsx
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

Важно не спутать `qa_stage_runs` с уже существующими `component_qa_runs`
(см. [manual-qa.md](manual-qa.md)) — это разные таблицы и разные API. Более
того, вкладка «Component QA» в карточке по-прежнему монтирует старую
`ComponentQaPanel` поверх `component_qa_runs`; `QaStageRunPanel` монтируется
только на вкладках «Интеграционные тесты» и «Automated QA». Записи
`qa_stage_runs` со `stage='component_qa'` создаются лишь через REST или в
тестах, но на видимость вкладки и автовыбор влияют.

## Граница реализации: исполнителя нет

Реализованы модель данных, идемпотентный старт, гейты перехода, отмена/повтор,
восстановление после рестарта, REST и UI-панель. Не реализовано выполнение:
runner'а, который вёл бы ран, нет. `startQaStageRun` сразу вставляет строку со
`status='running'` и `current_step='starting'`, а дальше состояние меняют только
действия пользователя и рестарт сервера. Следствия, которые надо знать до
чтения кода:

- `updateQaStageRun` и `completeQaStageRun` не вызываются ни маршрутом, ни
  сервисом — только тестами (`apps/server/src/db/database.qa.test.ts`). В
  рантайме ран не доходит до `success`/`gate_failed`, и карточка по этой линии
  сама по колонкам не едет;
- `progress`, `log`, `result` в проде остаются пустыми значениями по умолчанию,
  поля LLM (`llm_engine_id`, `llm_provider='claude'`, `llm_model=''`) никогда не
  заполняются: снимок движка зарезервирован в схеме, но не пишется;
- статус `awaiting_input` никто не выставляет, поэтому `answerQaStageRun` и
  форма «Ответ модели» в панели обычным путём недостижимы (маршрут и тест на
  них есть);
- доменного наполнения этапов (компоненты, Storybook-покрытие, список
  обязательных тест-кейсов и их связь с файлами тестов, наборы автотестов,
  диагностика упавших тестов, расход ресурсов) в этой сущности нет: `result` —
  нетипизированный `Record<string, unknown>`, панель печатает его как JSON.

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
этих ранов тоже нет: ни `protocol.ts`, ни `ws.ts`, ни `voiceStore` о них не
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

`QaStageRunPanel` (`packages/ui/src/components/qa/QaStageRunPanel.tsx`)
монтируется на вкладку и делает только GET: открытие вкладки ран не запускает.
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

Вкладка `integration_tests` больше не использует общий ран для исполнения.
Её runtime-состояние хранится в `integration_test_runs` и читается через
`GET …/qa/integration`. Start/cancel/complete/fix находятся под
`…/qa/integration/runs`. Общая `qa_stage_runs` остаётся совместимой
исторической моделью и продолжает обслуживать Automated QA; её старые
integration-записи могут влиять на видимость вкладки, но специализированная
панель показывает предметную историю.

Старт требует QA-разрешение и одной транзакцией проверяет нахождение карточки в
`integration_tests`, pushed CI-workspace, успешный development-ран на нём и
успешный readiness snapshot. Нарушения дают сохранённый `blocked`-ран с
конкретными причинами. Partial unique index по задаче для `queued|running`
обеспечивает идемпотентность. Валидная ветка без обязательных automatable-кейсов
создаёт `skipped` и сразу переводит карточку в `automated_qa`.

Проектные test stages исполняются fail-fast с `CI=1` и 30-минутным бюджетом.
Ран хранит команды, коды, длительности, классификацию, блокеры, сводку и
500-тысячный хвост лога. Рестарт закрывает активные попытки как
`blocked/infrastructure/server_restarted`. Смена workspace SHA или semantic
hash automatable-кейсов фиксируется при следующем старте как `stale`.

Complete не доверяет кнопке: сверяет сохранённый статус `passed|skipped`,
stale, SHA, snapshot version, команды и блокеры, затем вызывает существующий
`canCompleteAutomation`. Fix создаёт не более одного development-рана с
`stepId=integration_tests:<runId>`. Специализированная панель опрашивает
состояние раз в две секунды, защищает state от старого ответа и показывает
ветку/SHA, попытку, причины запуска, кейсы со ссылками, команды, лог, итог и
историю.

## Проверки

Сервер покрыт двумя кейсами в `apps/server/src/db/database.qa.test.ts`:
независимость и идемпотентность историй трёх этапов с переходами по гейту и
восстановление прерванных ранов в `interrupted`. UI — три DOM-теста
`QaStageRunPanel.dom.test.tsx` (лента и отмена, показ причин гейта и повтор,
ответ модели) и 12 сторис `QaStageRunPanel.stories.tsx` (по четыре состояния на
этап). Видимость и автовыбор вкладок в `TaskModal`, маршруты и запрет второй
активной попытки на уровне БД тестами не покрыты.
