# kanban-qa-stages-v1 — QA-этапы канбана выключены по умолчанию

Ран `kanban-qa-stages-v1`. Ветка задач — `dev`. Задачи выполняют воркеры MacBook (M2); M1 выключен.

## Что случилось

Владелец 2026-10-16: «Нужно, чтоб в прогоне не было Component QA, создания интеграционных автотестов, Automated QA,
ручного QA. Чтоб их не было по умолчанию». Сейчас автопилот ведёт карточку через все колонки доски по семантике
(`development → component_qa → integration_tests → automated_qa → manual_qa → awaiting_merge → merge → done`), колонки
создаются при создании проекта (`apps/server/src/db/repos/projects.ts`, список `['Component QA','component_qa']…`),
а без колонки этапа переход падает («<stage> column not found»). Этап выключить нельзя: у `automatedQaMode` только
`command`/`playwright`, у остальных этапов настроек нет. На SISL-737 (правка документации) Automated QA гонял полный
`npm test` и дважды падал на чужом флаке, задача прошла за 25 минут вместо 5. У воркеров Delivery Control гейт
встроен в попытку, в канбане тесты модель запускает сама; владелец решил, что отдельные QA-этапы по умолчанию не
нужны, а включаться должны явно в настройках проекта.

Целевое поведение:

- У проекта появляется настройка `qaStages` — какие из четырёх этапов включены: `component_qa`,
  `integration_tests`, `automated_qa`, `manual_qa`. По умолчанию все выключены, в том числе у существующих проектов.
- Автопилот после успешной разработки идёт в первый включённый этап, а если включённых нет — сразу в `awaiting_merge`
  (далее мерж по текущим правилам). Выключенный этап пропускается на любом шаге маршрута; `autoPilotRequiresManualQa`
  действует только при включённом `manual_qa`.
- Колонки выключенных этапов на доске скрыты (`kanban_columns.hidden`), ручной перенос карточки в скрытую колонку
  невозможен; при включении этапа колонка показывается снова. Колонки не удаляются — старые карточки в них остаются.
- Настройка редактируется в настройках проекта (владелец) и доступна по REST `PATCH /api/projects/:id`.

## Задачи интегратора (Claude, вне манифеста)

- После B01: выпуск и закрепление архива Shared (`core-contracts-release.mjs`) в Core, Kanban (`core-source.json`) и
  Core UI, затем запуск B02 и B03 на новой базе. После приёмки: выпуск Kanban и Core UI, закрепление в Core, релиз Core
  и деплой, проверка карточкой в проекте Sislexa: разработка → ожидает мержа → мерж → готово.

| B01 | Core | — | Project setting for enabled QA stages, per docs/plans/kanban-qa-stages-v1.md «Целевое поведение»: in `packages/shared/src/projects.ts` add `qaStages: QaStage[]` to the project detail and patch contracts with `QaStage = 'component_qa' \| 'integration_tests' \| 'automated_qa' \| 'manual_qa'`, a `normalizeQaStages` helper (unknown values dropped, order fixed) and `DEFAULT_QA_STAGES = []`; in `apps/server` persist it as `projects.qa_stages_json` (migration, default empty for existing rows), validate it in `PATCH /api/projects/:id`, return it in project details, and in the embedded board module route the autopilot after a successful development run and after every QA stage to the next enabled stage or to `awaiting_merge`, keep `autoPilotRequiresManualQa` effective only with `manual_qa` enabled, mark columns of disabled stages `hidden` (and unhide when enabled) without deleting them, and reject manual moves into hidden columns; tests for routing with none/some/all stages enabled and for the hidden columns; update `docs/kb/projects.md`. |
| B02 | Kanban | B01 | Enabled QA stages in the Kanban service, per docs/plans/kanban-qa-stages-v1.md «Целевое поведение»: adopt the `qaStages` project setting from the upstream Shared contract (copy of `@voicechat/shared` with the new `projects.ts`, declared in `core-source.json` until the next upstream shared copy): persist `qa_stages_json` with a migration defaulting to empty, expose it through the project routes and settings PATCH, route the autopilot after a successful development run and after each QA stage (`runManager`, `db/repos/qa.ts`, `db/repos/tasks.ts`) to the next enabled stage or straight to `awaiting_merge`, apply `autoPilotRequiresManualQa` only when `manual_qa` is enabled, keep the columns of disabled stages hidden and refuse manual moves into them, and skip the stage launches (`startQa`) for disabled stages; integration tests for the full autopilot path with all four stages disabled (development → awaiting_merge → merge → done) and with a single enabled stage; update `docs/kb/ci-qa-merge.md`. |
| B03 | core-ui | B01 | Project settings for enabled QA stages, per docs/plans/kanban-qa-stages-v1.md «Целевое поведение»: in `packages/ui/src/modules/projects/components/ProjectSettings.tsx` add a «Этапы проверки» group with four checkboxes (Component QA, Создание интеграционных автотестов, Automated QA, Ручное QA) bound to `qaStages` from the project detail (owner-only, saved through the existing update path), show the Automated QA mode and the manual-QA pause checkbox only when their stage is enabled, and hide hidden board columns in the board view and in column pickers; dom tests for the settings group and the board with hidden columns, a story for the settings state. |
