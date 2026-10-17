# board-operator-assistant-v1 — ассистент доски в роли оператора

Ран `board-operator-assistant-v1`. Ветка задач — `dev`. Задачи выполняют воркеры MacBook (M2); M1 выключен.

## Что случилось

Владелец 2026-10-17 поручил, чтобы ассистент канбана (разговор проекта с `assistantKind = 'kanban'` и инструментами
`mcp__kanban__*` из `apps/server/src/mcp/kanbanMcp.ts` сервиса доски) мог брать на себя роль оператора и отвечать так же,
как оператор Claude: отвечать на уточняющие вопросы моделей в ранах карточек (`waitForUser` в
`apps/server/src/ci/runManager.ts`, interaction `clarify` и `plan_approval`), разбирать карточки в «Требуется решение»
(`transitionAutoPilotTask(…, 'decision_required', …)` в `apps/server/src/kanban/module.ts`) и чинить типовые сбои:
повтор шага, «очистить и повторить» при грязной рабочей копии, перезапуск разработки, комментарий с причиной. Сегодня
это делает только человек или оператор Claude через API; ночью 2026-10-17 карточки core-ui #14 и Kanban #20 простаивали,
пока оператор не ответил «доступ к Core не нужен, работай в своём репозитории».

Целевое поведение:

- Настройка проекта `operatorAssistant: 'off' | 'answers' | 'full'` (по умолчанию `off`). `answers` — только ответы на
  вопросы моделей и комментарии; `full` — ещё повтор шага, очистка и повтор, перезапуск разработки, возврат карточки в
  «Готово к разработке». Мерж, релизы, деплой, выдача доступов и секретов ассистенту-оператору недоступны всегда.
- Когда ран задаёт вопрос или карточка уходит в «Требуется решение», сервис доски запускает ход ассистента-оператора с
  памяткой `docs/operator-playbook.md` и контекстом карточки (описание, критерии, шаги рана, хвост лога упавшего шага,
  вопрос). Ассистент действует через инструменты оператора, каждое действие оставляет комментарий «Оператор-ассистент: …».
  Если уверенности нет — пишет комментарий-эскалацию и оставляет карточку владельцу. Не больше трёх действий на карточку
  за сутки.
- В настройках проекта Core UI — переключатель «Ассистент-оператор» с тремя режимами; в ленте карточки действия
  ассистента видны с пометкой.

## Задачи интегратора (Claude, вне манифеста)

- После B01: выпуск Shared и закрепление в Core, сервисе доски (`core-source.json`) и Core UI. После приёмки: выпуск
  Kanban и Core UI, закрепление в Core, релиз Core и деплой; включение `full` для проектов Sislexa, core-ui и Kanban;
  проверка на проде: вопрос модели получает ответ ассистента, карточка с грязной рабочей копией сама очищается и повторяется.

| B01 | Core | — | Contract for the operator assistant (self-contained, repository `sislex/voiceAIChat`, branch `dev`): in `packages/shared/src/projects.ts` add `export type OperatorAssistantMode = 'off' \| 'answers' \| 'full'`, the list constant `OPERATOR_ASSISTANT_MODES`, the optional field `operatorAssistant?: OperatorAssistantMode` on the project detail and project patch types (absent means `off`) and the helper `normalizeOperatorAssistant(value): OperatorAssistantMode`; add `OperatorActionKind = 'answer' \| 'comment' \| 'retry_step' \| 'discard_and_retry' \| 'restart_development' \| 'move_ready' \| 'escalate'` and `OPERATOR_ACTIONS_BY_MODE` (answers: answer, comment, escalate; full: all); unit tests for the helper and the mode table; document in `docs/kb/protocol.md` and `docs/kb/projects.md` (no board logic in this repository, see `apps/server/src/kanban/boundary.test.ts`). |
| B02 | Kanban | — | Operator tools of the board assistant (self-contained, repository `sislex/sislexa-kanban`, branch `dev`): in `apps/server/src/mcp/kanbanMcp.ts` register, next to `kanban_task_get`, the tools `kanban_operator_queue` (cards of the project that need an operator: open `clarify`/`plan_approval` interactions with the question text, cards in `decision_required` with the decision reason, the failed step title, exit code and the last 60 log lines, runs in `failed`), `kanban_run_get` (run status, steps with status, open interactions, log tail), `kanban_interaction_answer` (text, or decision approved/rework for plans, through the same `answerInteraction` path as the run feed), `kanban_run_retry` (mode `step` = retry from the failed step, `discard` = discard the work tree and retry, through the existing routes' manager methods), `kanban_task_restart_development` and `kanban_task_comment`; every tool requires the conversation user to be a project owner and the conversation to be the project assistant (`assistantKind` null or `kanban`), returns a short Russian text and writes a card event; mirror the mode types locally in the copy of `@voicechat/shared` used by the service (declare it in `packages/shared/core-source.json` `divergent` until the next shared copy); tests in `kanbanMcp.test.ts` for each tool, the owner check and the assistant-kind check. |
| B03 | Kanban | B02 | Automatic operator turns (self-contained, repository `sislex/sislexa-kanban`, branch `dev`): add the project setting `operatorAssistant` (`projects.operator_assistant`, default `off`, exposed in project details and settings PATCH, owner only); add `docs/operator-playbook.md` with the operator rules: work only in the card's own repository and never ask for access to other repositories or secrets, pinning and releases are the integrator's job, answer clarifying questions from the card description and acceptance criteria, infrastructure failures (clone timeout, network during install, machine offline) get one retry of the step, a dirty work tree gets discard and retry, a failed gate with a real test failure gets restart of development with a comment naming the failing test, anything else or a second failure is escalated; when a run opens a `clarify` or `plan_approval` interaction or `transitionAutoPilotTask` moves a card to `decision_required`, and the project mode is not `off`, start one operator model turn with the playbook as instructions and the card context (title, description, acceptance criteria, run steps, failed step tail, open question) using the same model execution path as the card's development model step (`apps/server/src/ci/modelHooks.ts` / the run's execution LLM), with only the tools of B02 allowed by the mode (`answers`: answer, comment; `full`: all); at most three operator actions per card per 24 hours, kept in the database; every action adds a card comment starting with «Оператор-ассистент:»; tests with a fake model for an answered question, a discard-and-retry on a dirty work tree, the escalation path, the mode restriction and the daily limit; document in `docs/kb/ci-qa-merge.md`. |
| B04 | core-ui | — | Operator assistant in the interface (self-contained, repository `sislex/sislexa-core-ui`, branch `dev`): in `packages/ui/src/modules/projects/components/ProjectSettings.tsx` add the owner-only selector «Ассистент-оператор» bound to the project field `operatorAssistant` with the options «выключен» (`off`), «отвечает на вопросы» (`answers`), «отвечает и чинит» (`full`), saved through the existing update path (the field is optional; treat absence as `off`); in the task card feed render comments that start with «Оператор-ассистент:» with an assistant badge; dom tests for the selector and the badge and a story for the settings state. |
