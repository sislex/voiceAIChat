---
title: stand-model-api
date: 2026-11-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-model-api

## Changes

Mapped the stand model API pair to both runner endpoints and token, added catalog doctor with actionable errors, and enabled explicit upstream-only billing/tool-free mode. Core UI receives a warning flag. Health requests preserve the API prefix.

## Verified behavior

VC_CHAT_REQUIRE_BILLING=false alone does not bypass configured local Billing. VC_CHAT_MODEL_API skips local accounting and disables workspace tools. The two-Core WebSocket test now configures a local Billing transport that must never be called, verifies the reply, and checks upstream token-attributed usage.

## Knowledge

- docs/kb/deploy.md, Stand in three steps

## Validation

- `node --test scripts/stand.test.mjs`: passed (15 tests).
- `npm run test:files -- apps/server/src/turns.test.ts apps/server/src/llm/remoteClient.test.ts`: passed (129 tests).
- `npm run test:files -- apps/server/src/routes/modelRunner.test.ts`: passed.
- `npm run gate:fast`: attempted twice; the remote executor stopped each command at 300 seconds. Both attempts passed the selected tooling tests and all Core workspace tests (server: 2448 passed, 53 skipped), then entered browser integration. This is not a successful aggregate gate result.
- `node scripts/browser-gate.mjs --integration`: passed (exit 0) when run as a separate foreground stage within the 300-second limit. Thus all Core gate stages passed separately, but neither aggregate invocation completed.
- Core UI: typechecks and web build passed. Its `gate:fast` exited 1 on existing shell tests. The iframe test passed on retry; `lazyScreens.test.ts` also fails on clean `origin/dev` at `579812a`.

## Remaining validation

Tests use a fake runner and Billing fixtures. A real production-token smoke test has not been performed.
