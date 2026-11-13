---
title: model-api-kb-reconciliation
date: 2026-11-13
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# model-api-kb-reconciliation

## Repair scope

The project workflow failed its strict KB freshness check after implementation
commit `059901fdf`. No runtime implementation, tests, gate selection, area masks
or freshness rules were changed in this repair.

The 31 reported topics were compared with their tracked areas: current source,
the implementation diff, and earlier net changes since the checked revisions.
Shared entry points account for most of the overlap.

## Source reconciliation

| Topics | Source evidence and result |
| --- | --- |
| architecture, clients, deploy | Reviewed server/config/remote-client wiring, owner pins, Docker retry and deployment failure changes. Added the public Core model-provider boundary and its two per-token limits. |
| data-auth, protocol, server-internals, shared | Reviewed modelTokens, modelRunner, ChatAccounting, AccountingStore, REST usage and protocol changes. Documented verified authority, explicit routes, settlement attribution and the public prefix. Shared still declares its existing runner wire types in llm.ts. |
| features/llm-runners | Reviewed RemoteLlmClient frame observation and terminal delivery. Linked the tool-free, billed public adapter without implying that private accounting endpoints are published. |
| conversation-groups, image-retouch | Reviewed ChatRepo and REST changes. Branch/schema additions do not change group membership transactions or historyFiles attachment authorization. Documented the global models-token restriction on conversation/group APIs. |
| ui | Reviewed branch metadata, projected chat.history, assistant modes and Required context. Recorded these Core consumer contracts without claiming an owner UI release. |
| features/kb-usage, features/project-knowledge-base | Reviewed turns.ts, contextGating.ts and knowledge/mcp.ts. Added disabledTools enforcement before lookup/usage tracking and Chat-mode suppression. Other KB source changes are fixture/test adaptations. |
| features/kanban-assistant, features/make-browser, features/playwright-reader, projects, machines | Reviewed turn/context changes, Make stand selection, schema additions, repository diffs and unchanged machine/bridge implementation. Workspace tools obey effective context configuration; the new model API supplies no caller tools or machine authority. |
| features/ci-runner, features/feature-preview, features/manual-qa, features/merge-runner, features/qa-stage-runs, features/task-autopilot, features/task-preparation, features/releases | Verified retained contracts, empty QaRepo, removed workflow writers and the unchanged Kanban proxy/event boundary. Chat branch fields and the public model prefix do not restore extracted workflow managers. Existing ownership notes remain applicable. |
| conventions, testing-operations, features/release-gate-plan | Reviewed application/release/quick gate changes and package scripts. Documented releaseE2eFiles and the release flag; no gate was weakened or executed as part of this documentation repair. |
| stt-runner, tts-runner | Verified no net changes to voice clients or session.ts since their checked revision. Server/config additions concern the model API; existing voice transport remains unchanged. |

## Validation

`npm run kb:index`, `npm run kb:check -- --strict` and `git diff --check`
all completed with exit code 0 after touching the reviewed topics. Strict mode
reported all topics fresh, valid links and complete package coverage. The workflow
owns the full project-gate rerun; runtime tests and typecheck are not rerun for
this documentation-only repair.

