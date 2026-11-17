---
title: text-only-system-prompt
date: 2026-11-17
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# text-only-system-prompt

## Changes

Separated text-only conversation data from Core instructions. Added bounded systemPrompt
transport to the model API and capability negotiation with a legacy fallback.

## Verified findings

The previous text-only prompt mixed chat instructions with history on every Claude turn.
The runner's early text-only branch skipped the system-hint assembly.
Make output rules can be separated from the file snapshot without changing answer application.

## Knowledge updated

- docs/kb/llm.md

## Verification

`npm run gate:fast` passed (exit 0): affected application types, tests, builds and contracts.
Targeted transport/model-API tests passed; turns and Make tests passed after correcting the
empty-input guard inherited from appendChatInstructionHints.

## Workflow KB repair

The scoped strict gate required twelve topics whose areas overlap this task.
Reconciled their current Core sections with the changed areas since their checked
commits (`f30e2a6c0`, `dc3661513` for server internals, `059901fdf` for Shared).
Owner-only historical descriptions remain explicitly identified as migration context.
No runtime code, tests, gate configuration or areas were changed by this repair.

| Topic | Verified Core evidence |
| --- | --- |
| architecture | `turns.ts` separates text-only history/instructions; `llm/remoteClient.ts` negotiates capabilities. Reviewed dependency pin changes in `package.json`; module ownership remains unchanged. |
| features/kanban-assistant | `turns.ts:resumeQueues` includes non-chat queue IDs; workspace gating still excludes Kanban MCP on model API stands. Widget contracts and Kanban adapters have no intervening diff. |
| features/kb-usage | `turns.ts` still gates auto context and KB MCP by workspace mode and tracks usage through the same tracker. Knowledge package, usage writers and telemetry contracts have no intervening diff. Text unchanged. |
| features/llm-runners | `remoteClient.ts`, `sinks.ts`, `config.ts`, `routes/modelRunner.ts` and `shared/src/llm.ts`: separate instructions, discovery fallback, busy-thread reason and four-operation default. |
| features/make-browser | `turns.ts` and `makeTextFiles.ts`: Core-mediated Make calls, user file snapshots, system output protocol, live filtering and explicit-plan write prohibition. Browser binding code is unchanged. |
| features/merge-runner | Compared tracked Shared merge/project/protocol/temporary-resource contracts and Core Kanban bridges: no intervening changes. Shared turn assembly changes do not move merge execution into Core. Text unchanged. |
| machines | `turns.ts` and `imageRelocate.ts:hasImagesToRelocate` skip machine storage for plain answers; machine/tool authorization is unchanged. `db/repos/chat.ts` only adds queue ID recovery and empty-history filtering. |
| projects | `turns.ts:resumeQueues` and `db/repos/chat.ts:listTurnQueueConversationIds` recover all scopes. Project/task context remains workspace-gated; board contracts are unchanged. |
| protocol | `routes/modelRunner.ts` validates and forwards systemPrompt; `sinks.ts` recognizes the busy reason; `shared/src/types.ts` adds stopped/costPending. Frame shapes remain unchanged. |
| server-internals | Reviewed all changed source paths since dc3661513: separate prompt transport, Make text protocol, Stop session reset and empty-message exclusion in `db/repos/chat.ts` and `prompt/coldStart.ts`. |
| shared | Full Shared source diff since 059901fdf is confined to `llm.ts` and `types.ts`: optional system instructions/capability and Stop metadata. |
| ui | `turns.ts` supplies Stop metadata and all-scope queue snapshots, while diagnostics retain combined prompt size. Core UI remains a published owner artifact; no frontend implementation changed. |

After review, ran `node scripts/kb.mjs touch` for the twelve topics and
`npm run kb:index` successfully. `npm run kb:check -- --strict` no longer lists
any of these twelve topics; it returns 1 for twelve pre-existing topics.
For each remaining topic, `git diff --exit-code origin/dev -- <areas> <topic>`
returned 0, proving its document, metadata and implementation are unchanged
from the target and eligible for the workflow's existing scoped exemption.
The remaining topics are clients, conventions, conversation-groups, data-auth,
features/ci-runner, features/playwright-reader, features/project-knowledge-base,
features/releases, image-retouch, stt-runner, testing-operations and tts-runner.
Full gate, typecheck and build were left to the supervisor as requested for repair.

## Remaining acceptance

Live Haiku long-article and follow-up acceptance requires the updated Core and runner.
Neither service was released or deployed by this task.
