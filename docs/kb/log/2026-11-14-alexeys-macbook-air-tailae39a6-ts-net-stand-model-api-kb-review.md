---
title: stand-model-api-kb-review
date: 2026-11-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# stand-model-api-kb-review

## Review

Reviewed the only new area commit reported by strict freshness, `f30e2a6c0`,
against each topic's tracked paths and relevant current implementation. This repair
changes documentation only; it does not modify runtime code, tests or gate policy.

## Per-topic evidence

- `agent-api-access.md`: server.ts: consumer accounting guard only; token issuance, scope and provider authorization unchanged.
- `architecture.md`: server.ts, turns.ts, llm/remoteClient.ts and test: documented consumer billing/tool boundary and preserved base path.
- `clients.md`: config.ts/server.ts: consumer mode; documented source UI flag from dev-stand-local.mjs; artifact packaging unchanged.
- `data-auth.md`: server.ts: documented skipped consumer accounting; provider authority and settlement unchanged.
- `features/ci-runner.md`: server.ts: accounting/turn flag wiring only; CI proxy and owner workflow contracts unchanged.
- `features/kanban-assistant.md`: server.ts/turns.ts: documented explicit workspace override and omitted Kanban context/tools.
- `features/kb-usage.md`: server.ts/turns.ts: documented effective KB off; reports and telemetry APIs unchanged.
- `features/llm-runners.md`: config.ts/server.ts and llm/remoteClient.ts/test: documented consumer mode and prefixed health transport.
- `features/make-browser.md`: server.ts/turns.ts: documented workspace gate disabling model browser/tools; binding routes unchanged.
- `features/manual-qa.md`: server.ts: accounting/turn flag wiring only; QA contracts and proxy unchanged.
- `features/merge-runner.md`: server.ts/turns.ts: consumer chat mode only; owner merge execution and Core bridge unchanged.
- `features/qa-stage-runs.md`: server.ts: accounting/turn flag wiring only; stage events and proxy unchanged.
- `features/releases.md`: server.ts: accounting/turn flag wiring only; release scripts, contracts and proxy unchanged.
- `features/task-preparation.md`: server.ts: accounting/turn flag wiring only; preparation bridge and readiness contracts unchanged.
- `image-retouch.md`: server.ts: accounting/turn flag wiring only; existing chatTextOnly retouch rejection remains in force.
- `llm.md`: server.ts/turns.ts: documented consumer mode, upstream billing and effective workspace suppression.
- `machines.md`: turns.ts: documented suppressed machine resolution/remote tools; Agent protocols and stored bindings unchanged.
- `projects.md`: turns.ts: documented suppressed project/task context and Kanban tools; project/board contracts unchanged.
- `protocol.md`: routes/modelRunner.test.ts only: strengthened two-Core test for consumer billing bypass and upstream token usage; no wire change.
- `server-internals.md`: config/server/turns and remoteClient plus tests: documented consumer wiring and accounting ownership.
- `stt-runner.md`: config.ts/server.ts: new chat flag only; STT clients, protocol and runner configuration unchanged.
- `testing-operations.md`: stand.mjs, stand.test.mjs, dev-stand-local.mjs: documented doctor/config/warning checks and two-Core regression limits.
- `tts-runner.md`: config.ts/server.ts: new chat flag only; TTS clients, protocol and runner configuration unchanged.
- `ui.md`: server.ts/turns.ts: documented model API tool restriction and source UI warning flag; no artifact pin change.

## Validation

- `node --test scripts/stand.test.mjs`: 15 passed.
- `npm run test:files -- apps/server/src/turns.test.ts apps/server/src/llm/remoteClient.test.ts apps/server/src/routes/modelRunner.test.ts`: 137 passed.
- `npm run kb:index` and `npm run kb:check -- --strict`: passed; all topics fresh, links and package coverage valid.
- `git diff --check`: passed. Runtime source and types are unchanged; the full workflow rerun belongs to the supervisor.
- A real production-token smoke test remains unperformed; fixture results do not establish production spending.
