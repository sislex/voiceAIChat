# kanban-qa-stages-v2 — QA-этапы канбана выключены по умолчанию

Ран `kanban-qa-stages-v2`. Ветка задач — `dev`. Задачи выполняют воркеры MacBook (M2); M1 выключен.

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

| B01 | Core | — | Contract for enabled QA stages of a project (self-contained, no plan file in the checkout): in `packages/shared/src/projects.ts` add `export type QaStage = 'component_qa' \| 'integration_tests' \| 'automated_qa' \| 'manual_qa'`, `export const QA_STAGES: readonly QaStage[]` in pipeline order, `export const DEFAULT_QA_STAGES: QaStage[] = []`, `export function normalizeQaStages(value: unknown): QaStage[]` (drops unknown values, keeps the pipeline order, deduplicates) and the optional field `qaStages?: QaStage[]` on the project detail and on the project patch/update types next to `automatedQaMode`; document in the field comment that the board service owns persistence and routing, that an empty list means development goes straight to `awaiting_merge`, and that columns of disabled stages are hidden; unit tests for `normalizeQaStages`; the board cluster itself lives in the external board service and must not be implemented here (`apps/server/src/kanban/boundary.test.ts`); update `docs/kb/projects.md` with the new setting. |
| B02 | Kanban | — | Enabled QA stages in the board service (self-contained): add the project setting `qaStages` (`'component_qa' \| 'integration_tests' \| 'automated_qa' \| 'manual_qa'`, pipeline order, default empty also for existing projects) — persist it as `projects.qa_stages_json` with a migration, accept and validate it in the project settings PATCH route and return it in project details (mirror the `QaStage` type and `normalizeQaStages` in the local copy of `@voicechat/shared/projects.ts`, declared in `core-source.json` until the next upstream shared copy); route the autopilot after a successful development run and after each QA stage (`runManager`, `db/repos/qa.ts`, `db/repos/tasks.ts`) to the next enabled stage or straight to `awaiting_merge`, never launch `startQa` for a disabled stage, apply `autoPilotRequiresManualQa` only when `manual_qa` is enabled, keep the columns of disabled stages `hidden` (unhide when the stage is enabled, never delete) and refuse manual moves into hidden columns; integration tests for the full autopilot path with all four stages disabled (development → awaiting_merge → merge → done) and with a single enabled stage; update `docs/kb/ci-qa-merge.md`. |
| B03 | core-ui | — | Project settings for enabled QA stages (self-contained): in `packages/ui/src/modules/projects/components/ProjectSettings.tsx` add a «Этапы проверки» group with four checkboxes (Component QA, Создание интеграционных автотестов, Automated QA, Ручное QA) bound to the project field `qaStages` (array of `'component_qa' \| 'integration_tests' \| 'automated_qa' \| 'manual_qa'`, saved through the existing update path, owner-only), show the Automated QA mode selector and the manual-QA pause checkbox only when their stage is enabled, and hide board columns flagged `hidden` in the board view and in column pickers; dom tests for the settings group and for a board with hidden columns, a story for the settings state. |
