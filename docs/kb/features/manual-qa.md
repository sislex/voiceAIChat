---
title: Структурированное ручное QA
updated: 2026-08-14
checked: a64b490
areas:
  - packages/shared/src/qa.ts
  - packages/shared/src/projects.ts
  - packages/shared/src/protocol.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/db/database.ts
  - apps/server/src/routes/qa.ts
  - apps/server/src/server.ts
  - apps/server/src/ci/runManager.ts
  - apps/server/src/ci/componentQa.ts
  - apps/server/src/ci/testStages.ts
  - apps/server/src/ci/modelHooks.ts
  - packages/ui/src/components/qa
  - packages/ui/src/remote/qaBridge.ts
---

# Структурированное ручное QA

## Место в workflow

Успешный development CI без выполненного legacy-шага мержа переводит карточку в
системную колонку `component_qa`. Визуальная `qa_preparation` больше не входит в
workflow: миграция переносит её карточки в `component_qa` и удаляет пустую
legacy-колонку. Development-run больше не запускает LLM-подготовку сценариев
автоматически.

Сохраняемый механизм `qa_preparation_runs` остаётся частью структурированного QA:
записи переживают рестарт, хранят потоковый лог/ошибку, номер попытки и диагностику
и защищены UNIQUE(task_id, commit_sha). Ответ полностью валидируется до сохранения;
обязательны непустые title, steps и expectedResult. `completeQaPreparation`
требует хотя бы один активный полный сценарий и переводит задачу из текущего
Component QA в `manual_qa`; успешная подготовка создаёт привязанную к SHA активную
QA session. Только успешный `completeQaSession` переносит карточку в
`awaiting_merge`. Новый SHA помечает активную QA session stale.

## Автоматизированный Component QA

`component_qa_runs` — отдельная от `ci_runs`, `task_preparation_runs`,
`qa_preparation_runs` и ручных `qa_sessions` таблица (`schema.ts`, создание
идемпотентным `CREATE TABLE IF NOT EXISTS`; существующим карточкам в
`component_qa` миграция ничего не проставляет). Ран хранит id успешного
development-рана, ветку и commit SHA его workspace, номер попытки, статус
(`queued|running|passed|failed|blocked|cancelled|stale|skipped`), `ui_impact`,
id readiness-рана и семантическую версию снимка, снимки сценариев и
компонентов, результаты команд, артефакты, классификацию отказа, список
блокеров, сводку, потоковый лог, ссылку на Storybook, `stale_reason` и id
связанного fix-рана. Partial unique index по `task_id` при
`status IN ('queued','running')` запрещает второй активный ран; повторный
`POST …/qa/component/runs` возвращает существующий активный ран (202) вместо
создания нового. Флаги `canCancel` (queued/running) и `canRetry`
(failed/blocked/cancelled/stale) вычисляются при чтении, а не хранятся.

`startComponentQaRun` требует QA-разрешение (`canQa`: владелец либо
`project_members.qa_permission`), колонку задачи с `semantic_type =
component_qa`, pushed CI-workspace с ветку/SHA/машиной, успешный
development-ран на этом workspace и успешный `task_preparation_runs` с
`readiness_json`; всё выполняется в одной SQLite-транзакции. Перед созданием
нового рана тот же вызов помечает активный ран `stale` с причиной
`development_sha_changed` (SHA workspace изменился) или
`scenario_version_changed` (изменилась `componentQaSemanticVersion` —
FNV-1a-хеш стабильно сериализованных сценариев, компонентов, `uiImpact` и
флага конфликта критериев). Фонового наблюдателя нет: устаревание фиксируется
при следующем запросе старта и учитывается gate'ом при попытке перехода.
Снимок сценариев рана берёт из readiness только кейсы с
`testType ∈ {ui, automated, mixed}`.

`componentQaLaunchReasons` для UI-задачи требует непустой список компонентов и
хотя бы один обязательный component-сценарий; компонент со story обязан
заявить все семь признаков `StorybookCoverage`, компонент без story проходит
только с непустыми `exclusionReason` и `alternativeVerification`; конфликт
критериев приёмки тоже блокирует. `uiImpact=none` даёт пустой список причин,
сохраняется аудируемым `skipped`-раном и в той же транзакции переводит карточку
в `integration_tests` (через `canTransitionWorkflow('component_qa',
'integration_tests','automation')`). Неполные входы создают `blocked`-ран с
перечнем причин и оставляют карточку в `component_qa` — формального прогона не
начинается.

Клиент не передаёт путь, команду, SHA или машину: `componentQaExecutionContext`
достаёт их SQL-джойном ран → development-ран → workspace, причём только для
рана в статусе `queued` и workspace с `pushed = 1` и совпадающим
`commit_sha`. Настройка `projects.test_command` разбирается общим с merge-раном
модулем `apps/server/src/ci/testStages.ts` (единственная копия функции;
merge-ран передаёт дефолт `npm run affected-check`, Component QA —
`npm run test:storybook`): пустая настройка → дефолт вызывающей стороны, строка
без ведущей `[` → одиночная команда, валидный JSON-массив → список непустых
trim-нутых стадий, некорректный JSON с ведущей `[` выполняется как одна команда
и явно падает. Фолбэк `npm run test:storybook` существует в корневом
`package.json` как алиас `npm run build:storybook` (смоук-сборка Storybook —
единственная проверка, которая ловит сломанный рендер сториз).

Стадии исполняет `createComponentQaRunner`
(`apps/server/src/ci/componentQa.ts`, собирается в `server.ts`) последовательно
через тот же `ciExecutor` с `CI=1` в окружении каждой стадии; бюджет 30 минут
общий на ран — каждая стадия получает остаток. stdout всех стадий пишется в
единый `component_qa_runs.log` с обрезкой до последних 500 000 символов, и на
каждую стадию создаётся отдельная запись в `commands` (`commandId` вида
`stage-N`, текст команды, exit code, длительность, статус, диагностика); имя —
`Стадия N из M`, а у единственной стадии сохраняется прежнее
`Component / Storybook tests`, поэтому панель одностадийного рана выглядит как
до правки. Панель показывает все записи. Первый ненулевой код прерывает
оставшиеся стадии: все exit 0 → `passed`, ненулевой код → `failed` с
классификацией `implementation_defect` и диагностикой `non_zero_exit` у упавшей
стадии, timeout (в т.ч. исчерпание общего бюджета) или потеря исполнителя
(`exitCode == null`) → `blocked` с `infrastructure` и диагностикой
`command_timeout`/`executor_disconnected`; недоступный workspace даёт
`blocked` + `workspace_unavailable`. Итог рана по-прежнему присваивается всем
сценариям снимка. Отмена дергает `AbortController` из карты живых ранов и
переводит ран в `cancelled`. При старте сервера
`failInterruptedComponentQaRuns` закрывает все `queued|running` как `blocked`
+ `infrastructure` + `server_restarted`, поэтому статус задачи не меняется, а
повтор разрешён.

`canCompleteComponentQa` (чистая функция в `qa.ts`) допускает переход только
при статусе `passed`/`skipped` без `staleReason`, совпадении SHA и версии
снимка с текущими, отсутствии конфликта критериев, `passed` у каждого
обязательного сценария, полном Storybook coverage либо явном исключении с
альтернативой у каждого компонента, `passed` и exit 0 у каждой команды и
пустом списке блокеров; для `uiImpact=none` проверяется только сам факт
`skipped`. `completeComponentQaRun` повторяет gate на сервере, ещё раз сверяет
колонку и `canTransitionWorkflow` и только затем двигает карточку в
`integration_tests`; `getComponentQaTaskState` отдаёт те же причины в
`launchReasons`/`gateReasons` вместе с `canStart`/`canComplete`.

`POST …/qa/component/runs/:runId/fix` работает для `failed`/`blocked`-рана:
запускает один development-ран через `CiRunManager.start` (он же переносит
карточку в `development`), кладёт в `fix_context_json` `stepId` вида
`component_qa:<runId>`, хвост из сводки, лога, команд и артефактов (последние
50 000 символов) и список упавших/заблокированных сценариев с фактическим
результатом, после чего `linkComponentQaFixRun` закрывает ран как `failed` с
`implementation_defect` и сохраняет id fix-рана. Повторный вызов идемпотентен —
возвращает уже связанный ран.

WebSocket-событий у Component QA нет: `ComponentQaPanel`
(`packages/ui/src/components/qa/ComponentQaPanel.tsx`, встроена во вкладку QA
карточки над `ManualQaPanel`) читает состояние REST-мостом и опрашивает его раз
в две секунды, пока есть активный ран, поэтому переживает перезагрузку
страницы и рестарт сервера; ответ старше локального снимка (сравнение по
`finishedAt`/`startedAt`/`createdAt`) отбрасывается. Панель показывает ветку,
SHA, попытку, активность процесса, причины недоступности запуска, компоненты со
ссылками на story, сценарии, команды с exit code и длительностью, потоковый
лог, артефакты, сводку и историю попыток, а действия — «Запустить», «Отменить»,
«Повторить», «Открыть Storybook», «Отправить на доработку» и переход к
интеграционным автотестам (последний активен только при `canComplete`). Методы
`getComponent`/`startComponent`/`cancelComponent`/`completeComponent`/
`fixComponent` в `RendererQaBridge` объявлены опциональными: без них панель
показывает «Component QA недоступен».

Рядом появилась вторая, независимая сущность ранов QA-этапов `qa_stage_runs`
(`component_qa | integration_tests | automated_qa`) со своими REST-маршрутами
`…/qa/runs/:stage` и панелью `QaStageRunPanel`. Это не замена
`component_qa_runs`: таблицы, API и гейты у них разные, а вкладка «Component QA»
карточки монтирует именно `ComponentQaPanel` из этого раздела. Записи
`qa_stage_runs` со стадией `component_qa` создаются только через REST и влияют
на видимость и автовыбор вкладок. Подробности —
[qa-stage-runs.md](qa-stage-runs.md).

## Создание интеграционных автотестов

Стадия `integration_tests` использует отдельную таблицу
`integration_test_runs`, а не общий каркас `qa_stage_runs`. Ран привязан к успешному
development-рану, pushed workspace, ветке/SHA и последнему успешному
`task_preparation_runs.readiness_json`. В одной транзакции старт проверяет колонку,
workspace, development-ран и readiness; неполные входы сохраняются как аудируемый
`blocked`, повторный старт возвращает существующий `queued|running` ран, а
частичный уникальный индекс физически запрещает дубль.

Семантическая версия учитывает состав и содержимое automatable-кейсов, но не
ссылки автоматизации. Следующий старт помечает предыдущую попытку `stale` с
`sha_changed` или `snapshot_changed`. Если обязательных automatable-кейсов
нет, а обязательные исключения снабжены причиной и альтернативной ручной
проверкой, создаётся `skipped`-ран и карточка в той же транзакции переходит
в `automated_qa`.

Исполнитель запускает проектные test stages последовательно с `CI=1` и общим
бюджетом 30 минут; первый ненулевой код останавливает pipeline. Команды, exit
code, длительность и лог (последние 500 000 символов) сохраняются в ране.
Timeout/потеря исполнителя/рестарт классифицируются как
`blocked/infrastructure`, ненулевой exit — как
`failed/implementation_defect`. Перед прогоном сервер проверяет список файлов
последнего коммита: разрешены тестовые директории и `*.test|*.spec.*`; прочие
файлы блокируют ран как `non_test_files_changed`. Созданные ссылки
`{testId,path,updatedAt,commitSha}` записываются в канонический readiness-снимок.

`completeIntegrationTestRun` повторно сверяет статус, stale, SHA, semantic
version, команды и блокеры и обязательно вызывает общий
`canCompleteAutomation(testCases,currentSha)`. Только после успешной серверной
проверки карточка переходит в `automated_qa`. REST-контур находится под
`…/qa/integration` и включает state/start/cancel/complete/fix; fix-связка
идемпотентна через `linkedFixRunId` и передаёт development-рану
`stepId=integration_tests:<runId>`. Панель во вкладке показывает причины
недоступности, кейсы и ссылки, команды, лог, итог и историю, опрашивает активный
ран раз в 2 секунды и отбрасывает более старый ответ.

## Домен и критерий допуска

Общий контракт и чистые правила находятся в `packages/shared/src/qa.ts`.

Структурированный сценарий — `TestCaseDefinition`: стабильный `id` (переживает
правки, версии хранятся отдельно), `title`, `description`, `preconditions`,
`testData`, `steps`, `expectedResult`, флаги `required` и `automatable`,
`testType`, список `automationLinks` (`QaAutomationLink`: testId, path,
updatedAt, commitSha — привязка автотеста к SHA), `notAutomatedReason`,
`alternativeManualVerification`, `comments`. `QaCriterionTestType` — это
`ui | api | integration | negative | regression | manual` плюс читаемые, но не
предлагаемые заново legacy-значения `automated`, `mixed`,
`not_testable_in_app`; полный список экспортируется как
`QA_CRITERION_TEST_TYPES`, поэтому старые сохранённые сценарии не ломают чтение.

UI-часть снимка описывают `UiImpact`
(`none | existing_components | new_components | multi_component_flow`) и
`AffectedUiComponent`: `id`, `name`, `storybookStoryId` (или `null`),
`reusable`, `coverage`, `exclusionReason`, `alternativeVerification`.
`StorybookCoverage` — семь независимых булевых признаков: `stories`, `states`,
`fixtures`, `playFunctions`, `domTests`, `accessibility`, `visual`; значение
`null` означает «покрытие не заявлено». Всё это собирается в
`DevelopmentReadiness` (functionalRequirements, acceptanceCriteria, testCases,
uiImpact, affectedComponents, acceptanceCriteriaConflict) — тот же снимок
сохраняется в `task_preparation_runs.readiness_json` и позже читается стадией
Component QA. `canConfirmDevelopmentReadiness` пропускает в Ready for
Development только полный снимок: непустые требования и критерии, хотя бы один
обязательный сценарий с заполненными id/title/preconditions/steps/
expectedResult, заданный `uiImpact`, непустой список компонентов для любого
UI-влияния, компонент без story — только с непустыми `exclusionReason` и
`alternativeVerification`, а новый переиспользуемый компонент без story
отклоняется отдельной причиной. `canCompleteAutomation` требует для каждого
обязательного сценария либо `automationLinks` на текущем SHA, либо пару
«причина неавтоматизируемости + ручная альтернатива».
Acceptance criterion — отдельная сущность; смысловая правка создаёт новую
версию-снимок, связывает её с предыдущей и помечает активную QA session как
устаревшую. Редакционная правка с `semanticChange: false` обновляет текущую
запись без новой версии. Результат старой версии остаётся в истории и не
наследуется новой session.

QA session привязана к задаче, ветке, commit SHA, test run, снимку актуальных
критериев и, если задан, feature-preview. При старте создаётся отдельный
`not_tested`-результат на каждый активный критерий. Одновременно у задачи может
быть только одна активная session. Результаты используют `revision` для
optimistic concurrency; при конфликте UI перечитывает актуальный снимок. Закрытая
или stale session не принимает новые правки.

`canCompleteQa` допускает завершение, только когда session активна и не stale,
preview SHA совпадает с commit SHA, каждый обязательный критерий имеет результат
`passed`, каждый необязательный — `passed` либо `not_applicable`, отсутствуют
failed-результаты и общие замечания. В UI `not_applicable` называется
«Пропустить» и доступен только необязательным тестам. Missing, failed, blocked,
not_tested, in_progress и stale блокируют переход.

## Хранение, аудит и маршрутизация

SQLite-схема в `apps/server/src/db/schema.ts` разделяет текущие критерии,
неизменяемые версии, sessions, результаты, issues, attachments и аудит.
`VoiceChatDb` в `apps/server/src/db/database.ts` проверяет принадлежность
task/project/result, QA-разрешение и ревизию результата. QA-действия доступны
владельцу либо участнику с `project_members.qa_permission`; обычного членства
проекта недостаточно для аттестации.

Для `failed` обязательно одно пользовательское поле `comment` («Описание ошибки»);
служебный issue сохраняется с дефолтной классификацией. Сохранение failed-результата
само не закрывает session. Общие замечания хранятся в `qa_sessions.additional_issues` и сохраняются
отдельным `PATCH …/qa/sessions/:sessionId`; изменение требует QA-разрешения и
активной, не stale session. `POST …/qa/sessions/:sessionId/fix` доступен при
failed-тестах либо общих замечаниях, проверяет комментарии failed, запускает один
development-ран через `CiRunManager`, закрывает session и сохраняет id рана в
session и issues. Повтор возвращает связанный ран, а повтор retry подготовки во
время уже активного повтора возвращает текущий preparation-run с HTTP 202. Модель
development-рана получает исходную задачу, ошибки тестов и дополнительные
замечания именно связанной QA-попытки.

Аудит записывает создание/правку/версионирование критерия, старт и завершение
session, сохранение результата или черновика и добавление вложения. Текущая
реализация не предоставляет отдельный API чтения аудита и не транслирует
изменения QA через WebSocket.

## REST и скриншоты

Маршруты определены в `apps/server/src/routes/qa.ts`, а URL-контракт — в
`packages/shared/src/protocol.ts`. Под
`/api/projects/:projectId/tasks/:taskId/qa` доступны чтение состояния,
создание и пересмотр критерия, старт/завершение session, patch результата и
привязка скриншота.

Изображение сначала загружается в существующий постоянный `UploadStore`, затем
к результату сохраняется непрозрачный upload id и метаданные. Допускается до
десяти PNG, JPEG или WebP по 10 MiB на результат; route сверяет заявленный MIME,
расширение и magic bytes, отбрасывает части пути из имени. Публичный API не
раскрывает filesystem path. Скачать attachment может только участник проекта
через `/api/qa/attachments/:attachmentId`.

Текущая реализация не сохраняет размеры изображения, не удаляет EXIF и не имеет
QA-specific удаления вложений; безопасность и жизненный цикл самих байтов
наследуются от существующего `UploadStore`.

## Интерфейс

`ManualQaPanel` из `packages/ui/src/components/qa/ManualQaPanel.tsx`
встроен в модальное окно обычной задачи. Сверху находится раскрытая для running/
failed и автоматически свёрнутая для success лента preparation-run: статус,
попытка, время, длительность, сохранённый потоковый лог, диагностика и retry.
Во время выполнения панель опрашивает QA state раз в две секунды, поэтому после
повторного открытия восстанавливает снимок и продолжает обновлять ленту. Пока
preparation выполняется, тест-кейсы скрыты. Ниже session показывает commit/preview SHA,
раскрываемые сценарии и взаимоисключающие исходы «Успешно», «Ошибка», «Пропустить»;
последний отключён для обязательных тестов. Для ошибки раскрывается одно обязательное
описание, ниже списка сохраняются дополнительные баги. Сводка считает total,
required, passed, failed, skipped и remaining. «Отправить на доработку» запускает
связанный development-ран и открывает его ленту; «Прошёл тестирование» переводит
задачу в `awaiting_merge`. Закрытая, stale либо недоступная по возвращаемому сервером `canEdit` session
показывается read-only.

Web-клиент получает `window.qa` через REST-мост
`packages/ui/src/remote/qaBridge.ts`. В панели остаётся ручное создание сценария; отдельного UI версионирования,
назначения тестировщика, просмотра версий/аудита, удаления вложений и push-
обновлений нет.
