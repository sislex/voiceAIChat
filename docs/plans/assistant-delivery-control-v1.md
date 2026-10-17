# assistant-delivery-control-v1 — ассистент доски видит прогоны Delivery Control и повторяет задачи

Ран `assistant-delivery-control-v1`. Ветка задач — `dev` (у delivery-control — `main`). Задачи выполняют воркеры
MacBook (M2); M1 выключен.

## Что случилось

2026-10-17 владелец проверял в браузере, может ли ассистент канбана работать оператором так же, как оператор Claude из
консоли. На доске sislexa-make ассистент разобрал 22 карточки, но по SM-21 (прогон Delivery Control `card-SM-21`, гейт B01
упал дважды, задача ремонта окружения ENV тоже упала) ответил: «логи Delivery Control и состояние ENV недоступны через
предоставленный API». `kanban_run_get` не находит внешние раны: карточки из Delivery Control (поле `external` с
`source: 'delivery-control'` и `externalId` вида `<run>:<task>`, а у карточек с движком worker — `workerRunId`) не имеют
ранов доски. Оператор в консоли в этой ситуации смотрит `control status`, `control metrics`, артефакты попытки (логи гейта и
модели) и делает `control task retry` с причиной. У ассистента этого нет.

Целевое поведение:

- Координатор выдаёт токены оператора с областью проектов (`projectScope`): только чтение задач и попыток прогонов этих
  проектов, чтение текстовых артефактов попыток (хвост, с маскировкой секретов) и — если разрешено — повтор задачи с
  причиной. Остальные маршруты для такого токена закрыты.
- Сервис доски хранит этот токен у себя (файл, путь из переменной окружения), модели он никогда не показывается. Новые
  инструменты MCP — в чате ассистента доски и в ходах ассистента-оператора: состояние внешней задачи карточки, лог артефакта
  попытки, повтор задачи. Повтор доступен только в режиме ассистента-оператора `full` и считается действием в
  `operatorAssistantLimits`; в режиме `answers` — только чтение.
- Каждый повтор оставляет комментарий «Оператор-ассистент: …» с причиной. Мерж, приёмка, архивирование, слоты машин и
  выдача доступов остаются оператору-человеку.

## Задачи интегратора (Claude, вне манифеста)

- После B01: выкат координатора (`~/.local/bin/sislexa-coordinator-deploy`), затем выпуск токена с областью проектов
  админ-токеном: `POST /v1/admin/operator-tokens` с `projectScope` (все проекты, где включён ассистент-оператор, `retry:
  true`), срок 720 ч; секрет положить на прод в `/etc/voicechat/kanban/delivery-control-assistant.token` (mode 0400,
  владелец — пользователь контейнера доски), значение не печатать.
- После B02 и B03: выпуск Kanban, закрепление образа в Core, релиз Core, деплой; проверка в браузере (только модели Codex):
  в чате ассистента sislexa-make спросить про SM-21 — ассистент читает попытки и лог гейта, называет причину и при `full`
  повторяет задачу с причиной; в режиме `answers` повтор отклоняется.

| B01 | delivery-control | — | Project-scoped operator tokens for the board assistant (self-contained, repository `sislex/delivery-control`, branch `main`): in `src/operator-tokens.ts` add an optional `projectScope: { projectIds: string[] (uuid, 1..50); retry: boolean }` to `OperatorToken` and `operatorTokenCreateSchema` (mutually exclusive with `boardScope` and with non-empty `machines`); in `src/server.ts` a token with `projectScope` may call only three new routes and nothing else (`operator_scope_denied`): `GET /v1/projects/:projectId/tasks` (runs whose `projectId` equals the path id and is in the scope: run id, state, paused, tasks with id, kind, repository, state, attempts used and allowed, operator-queue reason, last failure code and short message, and for each attempt id, state, machine, start/finish, failure code, timeline phases with pass/fail and stored artifact names with sizes; ENV repair tasks of the run included), `GET /v1/projects/:projectId/attempts/:attemptId/artifacts/:name` (text artifact tail, default 16 KiB, query `tailBytes` up to 64 KiB, after the existing secret scan redaction; 403 `project_scope_denied` when the attempt's run belongs to another project, 415 for binary) and `POST /v1/projects/:projectId/tasks/retry` `{ runId, taskId, reason (10..500 chars), additionalAttempts 1..3 }` with Idempotency-Key, allowed only when `retry` is true, same semantics as `POST /v1/admin/tasks/retry`, refused with `assistant_retry_limit` after 3 scoped retries of one task within 24 hours, event attributed to `operator:<id>`; `scripts/control.mjs operator-token create` gains `--project-scope ID[,ID] [--retry]`; tests for scope isolation, route denial, redaction, tail limits and the retry limit; document in the docs topic about operator tokens. |
| B02 | Kanban | — | Delivery Control tools for the board assistant (self-contained, repository `sislex/sislexa-kanban`, branch `dev`): add `apps/server/src/operator/deliveryControl.ts`, a client of the coordinator using the existing `DELIVERY_CONTROL_URL` and a separate credential file from `DELIVERY_CONTROL_ASSISTANT_TOKEN_FILE` (read per call, sent only as the Authorization header, never logged, returned or put into prompts; 15 s timeout; only the short JSON `error` field of failures is surfaced). Contract of the coordinator routes: `GET /v1/projects/:projectId/tasks`, `GET /v1/projects/:projectId/attempts/:attemptId/artifacts/:name?tailBytes=`, `POST /v1/projects/:projectId/tasks/retry { runId, taskId, reason, additionalAttempts }` with Idempotency-Key. Resolve a card to its coordinator task: `task.external.source === 'delivery-control'` gives `externalId` `<run>:<task>`; a card with `workerRunId` gives the run and its implementation task. Register in both MCP servers (`apps/server/src/mcp/kanbanMcp.ts` for the chat assistant and `apps/server/src/operator/mcp.ts` for operator turns) the tools `kanban_external_task_get { taskId }`, `kanban_external_attempt_log { taskId, attemptId, artifact, tailBytes? }` and `kanban_external_task_retry { taskId, reason, additionalAttempts? }`; the retry tool exists only when the project operator mode is `full`, counts as a retry action in `operatorAssistantLimits` and leaves the comment «Оператор-ассистент: повтор задачи Delivery Control <run>/<task>: <reason>»; `kanban_run_get` on an external card answers with a pointer to the external tools instead of «not found»; operator turns of external cards get the external task summary in their context; without configuration the tools answer «Delivery Control не подключён к доске»; tests with a fake fetch for mapping, scope errors, redaction passthrough, mode gating and limits; update `docs/operator-playbook.md` and the KB topic on the operator assistant. |
| B03 | Core | — | Board service configuration for the assistant credential (self-contained, repository `sislex/voiceAIChat`, branch `dev`): in `docker-compose.yml`, service `kanban`, next to `DELIVERY_CONTROL_TOKEN_FILE` add `DELIVERY_CONTROL_ASSISTANT_TOKEN_FILE: ${DELIVERY_CONTROL_ASSISTANT_TOKEN_FILE:-/run/kanban-secrets/delivery-control-assistant.token}` (the directory is already mounted read-only from `VC_KANBAN_SECRETS_DIR`); update any compose or deployment test that enumerates the board service environment; document in `docs/kb/deploy.md` (board service section) that the file holds a coordinator operator credential with a project scope, how the operator provisions it (mode 0400, never printed) and that without it the assistant only reports that Delivery Control is not connected; run the KB touch, log and index steps. |
