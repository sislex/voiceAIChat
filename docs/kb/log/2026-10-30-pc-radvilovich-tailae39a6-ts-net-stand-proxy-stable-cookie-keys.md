---
title: stand-proxy-stable-cookie-keys
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# stand-proxy-stable-cookie-keys

## Changes

- Derived stand lease cookie keys with HMAC-SHA256 from the existing Core session signing secret and lease identity, truncated to 32 hex characters.
- Added HTTP regression coverage for proxy recreation, cookie reuse across listener ports and isolation of all identity fields and secrets.

## Verified findings

- Core already loads a persistent session signing secret from its data directory outside injected-database tests; StandProxy now receives that secret.
- The normalized effective hostname participates in lease identity; the allocated listener port and the Core page port do not.

## Documentation

- docs/kb/server-internals.md#dev-stand-access-proxy

## Strict freshness reconciliation

The strict workflow gate reported 20 topics after implementation commit
`91f51154`. Each topic tracks `apps/server/src/server.ts`. Compared the
topics and their areas with `git diff 7eea67be HEAD`: the only runtime change
outside `standProxy.ts` and its regression test is `secret: sessionSecret`
in the StandProxy constructor. No other tracked runtime files changed.
The HMAC uses the existing lease identity; the session verifier and project
membership callback remain unchanged. Reviewed the relevant topic boundaries
and the session/proxy sections before refreshing their markers.

| Topic | Result of comparison with the changed code |
| --- | --- |
| agent-api-access.md | API token management and REST/WS authentication are unaffected. |
| architecture.md | Application composition is unchanged apart from StandProxy receiving the existing session secret. |
| clients.md | Frontend artifacts and client transport are unchanged. |
| data-auth.md | Documented reuse of the session signing secret; authentication and membership checks remain enforced. |
| deploy.md | Documented persistence requirements and stable cookies across listener-port reassignment. |
| features/ci-runner.md | CI contracts, state, execution and proxy registration are unchanged. |
| features/kanban-assistant.md | Widget context, relay and Kanban proxy are unchanged. |
| features/kb-usage.md | KB telemetry, brokers and report endpoints are unchanged. |
| features/llm-runners.md | Runner selection and transport are unchanged. |
| features/make-browser.md | Browser-session binding and MCP routing are unchanged; stand cookie details remain in server-internals. |
| features/manual-qa.md | QA persistence and Kanban execution boundary are unchanged. |
| features/merge-runner.md | Merge contracts, run feeds and Kanban manager boundary are unchanged. |
| features/qa-stage-runs.md | QA stage contracts, subscriptions and persistence are unchanged. |
| features/releases.md | Release scripts, artifact pins and subscriptions are unchanged. |
| features/task-preparation.md | Preparation proxy and remote/offline Kanban selection are unchanged. |
| image-retouch.md | Retouch admission, uploads and processing are unchanged. |
| llm.md | Turn execution, runner lifecycle and MCP dispatch are unchanged. |
| stt-runner.md | STT client construction and voice transport are unchanged. |
| tts-runner.md | TTS client construction and voice transport are unchanged. |
| ui.md | UI artifacts, routes and performance collection are unchanged. |

The detailed HMAC and cookie identity description remains in
`server-internals.md#dev-stand-access-proxy`. No gate command or freshness
rule was changed.

## Remaining work

- The workflow reruns the complete project gate after this repair.
