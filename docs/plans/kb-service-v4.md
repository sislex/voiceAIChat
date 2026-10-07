# kb-service-v4 — знания LLM Runner и речи уходят из ядра

Ран `kb-service-v4`. Ветка задач — `dev`. Продолжение `kb-service-v3`.

Владелец, 2026-10-07: в ядре не должно быть данных о коде модулей; ссылки — только на уровне модуля
(`<module>:README.md`). `kb-service-v3` перенёс знания Core UI, Kanban, агента, Make, читалок, UI Kit и
Image Studio; здесь — темы ядра `llm.md`, `stt-runner.md`, `tts-runner.md`, `stt-tts.md` и связанные
разделы `architecture.md`, `server-internals.md`, `deploy.md`.

## Что видно сейчас

Из 52 разделов 28 описывают собственную интеграцию ядра (шлюз LLM, оркестрация хода, MCP-мост,
конфигурация, хранение, контракты `packages/shared`) и остаются в ядре. 7 разделов принадлежат
llm-runner (348 строк), 17 — voice (205 строк); 20 разделов смешанные — модулю уходит его часть,
в ядре остаётся отмеченное `core keeps`. Таблица — [kb-service-v4-assignment.md](kb-service-v4-assignment.md).
Пакеты разделов лежат в `docs/kb/import/core-sections.md` ветки `dev` каждого модуля вместе с
`vendor/sislexa-kb-tools-0.1.0.tgz`. У обоих модулей нет базы знаний.

Расхождения с кодом, найденные при нарезке: в llm-runner нет отображения reasoning effort
(`--effort`, `model_reasoning_effort`), описанного в «Модель вызывается как CLI»; в voice цели Docker —
`stt`/`tts`, пакет — `@sislexa/voice`, контракты — `packages/voice-contracts` (в ядре старые имена).

## Решения

1. Как в `kb-service-v3`: этап 0 — модули заводят базы знаний и сверяют каждый факт с кодом; этап 1 —
   ядро удаляет их разделы и оставляет ссылку уровня модуля.
2. Строгий `kb:check` требует `AGENTS.md` в каждом пакете — задачам этапа 0 они разрешены.

| B01 | llm-runner | — | LLM Runner knowledge base from scratch: set up the repository KB like Make (`kb.config.json` with kbDir docs/kb, packageGlobs `packages/*`, logDir docs/kb/log, indexPath docs/kb/README.md; devDependency `@sislexa/kb-tools` from vendor/sislexa-kb-tools-0.1.0.tgz; scripts kb:check (`sislexa-kb check --strict`), kb:index, kb:log, kb:context; add `npm run kb:check` to `npm run gate`); write topics for this repository (architecture and processes, runner HTTP API and contracts, Claude/Codex CLI invocation and sessions, receipts and accounting, profiles, relays and deployment, tests) using docs/kb/import/core-sections.md (Core sections owned by LLM Runner, copied from Core d58a37e0; `<!-- core keeps: … -->` marks Core-owned parts that stay out) and the code — verify every fact against the code (for example the reasoning-effort mapping described in Core is not in this repository: describe what the code does), fold in the relevant facts of docs/operations.md without deleting it; add a short `AGENTS.md` to every workspace package (`packages/contracts`) pointing to its topics; set real `areas`; run `npm run kb:index`; delete docs/kb/import; finish with a docs/kb/log entry mapping every imported section heading to `topic.md#anchor` or «dropped: reason». Gate: `npm ci` then `npm run kb:check`. |
| B02 | Voice | — | Voice knowledge base from scratch: set up the repository KB like Make (`kb.config.json` with kbDir docs/kb, packageGlobs `apps/*` and `packages/*`, logDir docs/kb/log, indexPath docs/kb/README.md; devDependency `@sislexa/kb-tools` from vendor/sislexa-kb-tools-0.1.0.tgz; scripts kb:check (`sislexa-kb check --strict`), kb:index, kb:log, kb:context; add `npm run kb:check` to `npm run gate`); write topics for this repository (architecture and boundaries, STT runner protocol, models and health, TTS engines and voices, container and configuration, browser microphone package, voice contracts, tests) using docs/kb/import/core-sections.md (Core sections owned by voice, copied from Core d58a37e0; `<!-- core keeps: … -->` marks Core-owned parts that stay out) and the code — verify every fact against the code (Core uses old names: Docker targets are `stt`/`tts`, the package is `@sislexa/voice`, contracts live in `packages/voice-contracts`), fold in the relevant facts of docs/operations.md without deleting it; add a short `AGENTS.md` to every workspace package (`apps/stt-runner`, `apps/tts-runner`, `packages/voice-browser`, `packages/voice-contracts`) pointing to its topics; set real `areas`; run `npm run kb:index`; delete docs/kb/import; finish with a docs/kb/log entry mapping every imported section heading to `topic.md#anchor` or «dropped: reason». Gate: `npm ci` then `npm run kb:check`. |
| C01 | Core | B01, B02 | Remove LLM Runner and voice knowledge from the Core knowledge base per docs/plans/kb-service-v4.md and the table docs/plans/kb-service-v4-assignment.md (every Core section with its owner module and the part Core keeps). For every row whose owner is not `core`: delete the section from the Core topic, or, when «Core keeps» is not empty, rewrite the section to only that Core-owned part. A topic that keeps Core content gets one line per affected module «Module details: `<module>:README.md`»; a topic left without Core content becomes a stub of a few lines with that link. Never link to module sections or anchors and never keep module facts. Do not change sections owned by `core`. Update docs/kb/modules.md: `llm-runner` and `voice` now have knowledge bases (`llm-runner:README.md`, `voice:README.md` with `docs/kb`). Fix links inside Core docs that pointed to removed sections. Finish with the usual KB steps (`node scripts/kb.mjs touch` for changed topics, `npm run kb:log -- kb-service-v4`, `npm run kb:index`). Gate: `npm run kb:check`. |
