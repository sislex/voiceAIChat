---
title: Public chat release isolation and lowercase product naming
date: 2026-10-20
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Public chat release isolation and lowercase product naming

## Changes

Documented the explicit separation of the protected full installation, local
chat candidate and future public site. Current Core instructions and KB prose
use lowercase `sislexa`; technical identifiers and historical quoted output or
commit titles are preserved. No application code or deployment defaults changed.

## Verified findings

Read-only HTTP, authenticated application/project metadata and Docker/component
inspection confirmed the old host remains Core 0.1.480 at
`9c44cb0d211cf23b42de0dcb2735c06ffae8507d`, with all seven local applications,
project `voiceaichat`, full services and component environment `production`.
The local candidate has distinct data, project, loopback ports and component
identity. The public target is not provisioned yet.

Root Compose fixes Core's volume name to `voicechat-server-data`; changing only
the Compose project name would share data. Public commissioning therefore needs
an explicit dedicated mount/name. The existing Release Center targets the old
host; even train without `--deploy` submits branch preparation, and resume retains
saved deploy intent. The launch uses reviewed PRs and immutable publication,
without changing that environment or invoking the old deploy wrapper.

Recorded the current stacked Core PRs and UI/Identity/Billing/Runner owner PRs.
Existing owner versions are already published; new candidate bytes require new
unused versions, exact provenance and gates before Core pins change. Shared
0.1.43 is the planned optional analytics contract for the accompanying UI work.

## Verification

`python3 -m unittest discover -s scripts/prod -p test_compose_env.py` passed all
11 existing selector/voice/default fixtures. Required
`gate:quick -- --base 55bbb8649911d77fc68e639f81ad8088e2112ad3` exited 0 with a
docs-only plan (no application tests selected); `kb:index`, `kb:check` and
`git diff --check` passed. KB check still reports 32 pre-existing topics needing
review and two packages without AGENTS instructions; unrelated topics were not
marked reviewed. The Python fixture run regenerated a tracked bytecode cache,
which accidentally broadened two gate attempts; those attempts were stopped,
the original cache bytes were restored, and the clean docs-only gate then passed.
Production inspection ran
only reads; no service, configuration, ledger, registry or data mutation occurred.

## Knowledge locations

- `docs/kb/deploy.md`: isolation boundaries and legacy release target guard.
- `docs/plans/public-chat-v1.md`: reviewed publication chain and commissioning.
- `docs/kb/architecture.md`: product/domain identity and identifier preservation.
- Current terminology in conventions, glossary, Shared and testing topics.

## Remaining work

Finish companion source reviews/gates, publish new immutable owner versions and
update the Core composition through reviewed PRs. DNS, mail, the public service
account and the distinct public deployment remain separate commissioning work.
