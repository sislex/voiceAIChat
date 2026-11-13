---
title: stand-kb-reconciliation
date: 2026-11-13
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# Portable stand KB reconciliation

The project gate reached strict KB validation and reported eight affected stale
topics. The earlier mirror transport failure is no longer the reported blocker.
This repair changes documentation only; it does not alter gate selection or
freshness checks.

## Source evidence

Reviewed topic frontmatter areas and their net source changes from each previous
checked SHA to e8f70a79e, including changes predating the stand commit:

| Topic | Checked implementation and conclusion |
| --- | --- |
| architecture.md | package.json, scripts/affected-check.mjs and file-storage configs: portable commands and local-state exclusions. server.ts and turns.ts: chat.history publication, effective context MCP filtering and Make stand/Reader selection. Added the development-checkout boundary and current host behavior. |
| conventions.md | application-gate.mjs, quick-gate.mjs, root package scripts, Shared/Server tsconfigs: .stand filtering, existing dev/release tooling separation and exclusions. Added the stand exclusion rule. |
| features/ci-runner.md | affected-check.mjs: .stand is harmless to package selection. db/repos/ci.ts removal of workflow writers matches the existing owner boundary; eventsDelivery.test.ts awaits agent readiness and fixture writers. Shared protocol and schema changes concern chat branches, not CI orchestration. server.ts Make browser wiring and Compose owner pin changes do not move CI execution into Core. |
| features/project-knowledge-base.md | packages/kb-tools/kb.mjs and search.mjs skip .stand; packages/knowledge/src/mcp.ts rejects per-turn disabled search/document/topics. kbMcp.test.ts verifies the guard; access/rpc tests use the extracted fixture writers. Added both missing behaviors. |
| features/release-gate-plan.md | application-gate.mjs filters stand paths and separates development/release suites; release-gate.mjs uses gate:all -- --release and restores deferred suites. Corrected the full command and documented selection. |
| features/releases.md | application-gate.mjs and affected-check.mjs isolate .stand. Shared chat history/branch contracts, Make browserTarget RPC, schema migration, server wiring and Compose pins preserve release ownership. Added the distinction between local dev checkouts and immutable release artifacts. |
| kb-workflow.md | Only packages/kb-tools/kb.mjs and search.mjs changed in its areas since checked: both skip .stand. Verified checked-SHA/same-topic-commit semantics in kb.mjs. Added traversal and multi-topic reconciliation guidance. |
| testing-operations.md | stand.mjs, stand.test.mjs, launcher diff, planner/tree-walk diffs and Vitest configs: portable CLI tests and exclusions. Compose delta only advances Make/Reader image pins. Added focused test command and live-acceptance limits. |

All eight topics were touched through node scripts/kb.mjs touch after review.
The generated index was rebuilt through npm run kb:index.

## Validation

- node --test scripts/stand.test.mjs packages/kb-tools/cli.test.mjs: 23 passed, exit 0.
- npm run kb:check -- --strict: exit 1 for 24 pre-existing topics; none of the eight repaired topics remains stale.
- KB-only part of the supplied workflow command, with its unchanged baseline-area and metadata exemption rules: exit 0; all topics, links and package instructions pass. The child-only overlay does not edit pre-existing topics; its temporary files were removed.
- No source or type declarations changed in this repair; typecheck and the complete project gate remain with the supervisor.

Live multi-repository stand commissioning and admin login remain outside this
repair's verification. Existing user stands were not started, stopped or modified.
