# make-stand-delivery-v1 — правка со стенда в dev и обратно на стенд

Ран `make-stand-delivery-v1`. Ветка задач — `dev`. Продолжение [make-stand-inspector-v1](make-stand-inspector-v1.md)
и [make-stand-stories-v1](make-stand-stories-v1.md).

## Цель владельца (2026-10-12)

- Владелец правит большой проект на стенде (ветка `make/conversation-<id>` репозитория компонента, например
  Core UI на «Проекте 35»). В Make нет полноценной проверки, поэтому такие правки должен принимать интегратор
  Delivery Control и вливать в `dev` того же репозитория.
- После этого из `dev` нужно влить изменения обратно в ветку стенда и увидеть их на стенде.

## Как это делалось вручную 2026-10-12

PR `make/conversation-94a14098` → `dev` core-ui (#111), `npm run gate:task -- --base <dev>` на M2, слияние,
dev → main (#112), `release/core-ui-1.5.12` (#113), публикация `owner-release-publish`, пересборка Desktop с
новым Core UI, закрепление обоих в Core, релиз Core. Обратно: `git merge origin/dev` в ветку стенда, push,
кнопка «Pull» во вкладке Repository стенда. Всё это — ручная работа оператора.

## Решения

- **«Отправить в dev» во вкладке Repository стенда.** Make пушит ветку стенда и создаёт кандидат в Delivery
  Control: координатор получает новый вид кандидата `branch` (репозиторий, ветка стенда, целевая ветка `dev`,
  автор, описание). Интегратор принимает его тем же конвейером, что кандидатов воркеров: клон `dev`, применение
  коммитов ветки (rebase/merge), `gate:task -- --base <dev head>` из `integrationGates`, публикация ветки
  `<run>/<task>` и PR в `dev`, слияние при зелёном гейте, отчёт. Для таких кандидатов прогон — служебный
  `stand-delivery` (один на проект), задача создаётся на лету: `T-<дата>-<sha8>`.
- **Статус доставки виден в Make.** Карточка во вкладке Repository: «отправлено → гейт → влито в dev →
  отклонено (лог гейта)». Источник — события координатора `candidate.*`/`attempt.integration_*` через Core
  (`/api/projects/:id/dev-stands/:stand/deliveries`). Отклонение показывает хвост лога гейта и кнопку
  «Повторить».
- **«Обновить из dev» там же.** Core через агент стенда выполняет `git fetch origin && git merge --no-edit
  origin/dev` в рабочей копии стенда (конфликт — показать список файлов и остановиться, ничего не сбрасывать),
  затем «Pull» не нужен: Vite/HMR стенда подхватывает файлы; для Storybook стенда — перезапуск сессии.
  Кнопка показывает, на сколько коммитов ветка стенда отстаёт от `dev`.
- **Выпуск в прод остаётся за оператором** (release-train Core UI → Desktop → Core); план фиксирует только
  путь до `dev` и обратно на стенд. Отдельный план добавит кнопку «Выпустить» позже.

## Общий контракт

- Coordinator: `POST /v1/candidates/branch {repository, branch, targetBranch, headSha, title, author}` (operator
  token проекта) → `{runId:'stand-delivery', taskId}`; события `candidate.branch_submitted`,
  `attempt.integration_integrated|integration_failed` с `taskId`; `GET /v1/status` показывает такие задачи как
  обычные.
- Core: `POST /api/projects/:id/dev-stands/:standId/deliveries {branch, title}` → проксирует в координатор
  (токен интеграции проекта); `GET …/deliveries` → список с состояниями; `POST …/sync-dev` → merge `origin/dev`
  в рабочую копию стенда через агент, ответ `{merged:boolean, behind:number, conflicts:string[]}`.
- Make: вкладка Repository получает блок «Доставка» с кнопками «Отправить в dev», «Обновить из dev» и списком
  доставок; `make-contracts` описывает `StandDelivery` и `StandSyncResult`.

## Задачи интегратора (Claude, вне манифеста)

- Копии плана в `docs/plans/` delivery-control и make до старта.
- После приёмки: выкат координатора и воркеров (`integrator` принимает branch-кандидаты), релизы Make и Core,
  проверка на «Проекте 35»: правка на стенде → «Отправить в dev» → влито → «Обновить из dev» → изменения видны.

| B01 | delivery-control | — | Branch candidates for stand deliveries, per docs/plans/make-stand-delivery-v1.md «Решения» and «Общий контракт» (copy of the plan is in this repository): `POST /v1/candidates/branch` (operator token scoped to the project's board token) creates or reuses the service run `stand-delivery` for the repository with an auto-generated task `T-<yyyymmdd>-<sha8>` (targetBranch from the request, allowed paths unrestricted, no model phase) and a submitted candidate whose patch is the diff of the branch head against the target branch head; `src/integration-queue.ts`/`src/worker/integrator.ts` integrate it exactly like worker candidates (clone target, apply, `integrationGates`, publish `<run>/<task>`, PR, merge on green); events `candidate.branch_submitted` and the existing integration events carry `runId`/`taskId`; `GET /v1/status` lists the task; tests for the route, the generated task and the integrator path with a fake remote; docs/candidate-integration.md. Gate: `npm run gate:task -- --base <sha>`. |
| B02 | Core | — | Stand delivery and dev sync routes in Core, per docs/plans/make-stand-delivery-v1.md «Общий контракт»: `POST /api/projects/:id/dev-stands/:standId/deliveries {branch, title}` pushes nothing itself but forwards `{repository, branch, targetBranch:'dev', headSha, title, author}` to the coordinator's `/v1/candidates/branch` with the project's integration token (`apps/server/src/makeBridge` adapters), `GET …/deliveries` returns the last 20 deliveries with states `submitted|gating|integrated|rejected` from coordinator status/events (cached 10 s), `POST …/sync-dev` runs `git fetch origin && git merge --no-edit origin/dev` in the stand working copy through the stand agent and answers `{merged, behind, conflicts}` without resetting anything on conflict; contracts in `packages/shared` (`StandDelivery`, `StandSyncResult`); tests with a fake coordinator and a fake agent; docs/kb/server-internals.md. Gate: `npm run gate:quick -- --base <sha>`. |
| B03 | Make | — | Delivery block in the stand Repository tab, per docs/plans/make-stand-delivery-v1.md «Решения» (copy of the plan is in this repository): `MakeProjectStand` Repository view gets «Отправить в dev» (pushes the stand branch through the existing push action, then calls Core `deliveries`), «Обновить из dev» (calls `sync-dev`, shows `behind` before and the result after; conflicts are listed, nothing is reset), and the deliveries list with states and the gate log tail for rejected ones with «Повторить»; `make-contracts` gets `StandDelivery`/`StandSyncResult`; localization RU/EN; DOM tests with a fake API; docs/kb/project-mode.md. Gate: `npm run gate:task -- --base <sha>`. |
