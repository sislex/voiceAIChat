---
title: public-chat-models
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Public chat model policy

## Changes

- Added deployment model selection (`VC_CHAT_MODELS`) to configuration, Compose,
  personal access APIs, context inspection and actual turn admission.
- Preserved user revocations and rejected fallback to an excluded provider.
- Added readable messages for daily Billing admission errors.

## Evidence

- Focused Core tests: 114 passed, including actual runner request selection.
- Full Core gate (quick gate expanded by Compose): passed. An initial browser
  search timeout passed its 18-test file rerun and the complete gate rerun.
- Added VC_CHAT_TEXT_ONLY to force tool-free runner requests. Offline probes on
  Codex 0.154.0/Docker and 0.156.1/Mac passed for all three models, including
  resume and rejection of an unsolicited shell read. Real model calls remain
  an installation acceptance step.
- Identity signup fix: owner full gate passed; PR sislex/identity#35.
- Billing daily admission: owner full gate passed. The last answer can exceed
  the threshold; one unresolved answer per user prevents concurrent bypass.

## Knowledge

- docs/kb/deploy.md
- docs/kb/data-auth.md

## Remaining work

- Publish and integrate owner releases, configure managed Billing and local SMTP
  on the existing Docker stand, verify all three models and the quota UI.
- Verify public-chat executor isolation before opening signup on sislexa.by.
- Configure real outbound email when commissioning the public site.
