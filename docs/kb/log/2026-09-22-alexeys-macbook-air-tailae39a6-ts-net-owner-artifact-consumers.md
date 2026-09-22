---
title: owner-artifact-consumers
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Owner artifact consumers

Removed the 25 compatibility workspaces, Browser Runner/browser contracts source,
and pure Identity/Voice compatibility exports. Consumers use published package
exports and owner-built frontend/recorder assets. Owner helper suites were migrated
before Core copies were removed. UI Foundation 0.1.5 fixes the host test helper's
Make contract imports. Core artifact integrity/provenance checks pass; the interim
consumer typecheck passed before the final worker/proxy import cutover.

Core 0.1.322 is deployed and its acceptance/latency caveat is recorded in deploy.md.
The current owner-artifact worktree has not passed canonical gates or been released.
Owner service images are published; available GitHub credentials cannot pull GHCR
images, so exact clean released commits are also being built locally for deployment.
These local image IDs are recorded separately and are not claimed to be registry
manifest digests.

Remaining work includes the public Reader fixture/proxy releases, canonical Core
gates, Release Center owner preparation, remaining product-only browser scenarios,
embedded LLM Runner removal and production owner-service cutovers. Full repository
extraction must not be marked complete before those checks and cleanup finish.

Owner browser migrations passed full local gates: Make 1.1.6 PR #7 (eight
scenarios), Image Studio 1.0.8 PR #33 (three scenarios). Studio release is
published and pins updated; Make publication is pending CI. Studio standalone
viewport and synchronous viewer-navigation regressions were fixed at the owner.
Core gate:fast first pass failed four stale consumer checks; corrected Identity
source-absence/table boundary, recorder dev target and a generated-image fixture
that now exercises capture with distinct bytes rather than owner deduplication.
The 23 affected server bridge checks pass. A new full gate is still required.
Identity owns login selector and SQL-table guards; Core no longer reads owner
implementation for those tests. Web Reader owns the module boundary assertion.

The canonical model audit removed 51 Make/Browser/Studio/SDK model/test files,
plus five Voice STT/TTS/PCM files and four Identity entitlement/password-policy
files. Owner gates passed before removing Core copies; the PCM test was byte-for-
byte identical to Voice's existing suite. Core retains its resource authorization,
transport, host and integration assertions. Identity and Voice model releases are
being completed independently; local release candidates are used only for early
consumer validation and must match published artifacts before the Core PR.

The second Core adapter gate failed the unchanged route JS budgets: the recorder
contract imported the Core Shared barrel, eagerly retaining Make template
initializers. Web Reader now consumes canonical Browser leaf exports. The first
full consumer typecheck after deleting model copies exposed remaining owner
inline types/re-exports; fixes are in Image Studio PR #35, Web Reader PR #9 and
Identity PR #11. Make/PW 1.2.1 correct distribution peer ranges and add peer
consistency checks; clean Core dependency installation succeeds after pinning all
new owner contract packages at the root. No candidate has been deployed; Core
0.1.322 remains production.

Identity 1.3.0 (a1e8cae26b18), Web Reader 1.2.1 (295807f94d7c),
Studio 1.1.1 (689ea715c7e5) now have published main artifacts and local amd64
images. Core pins use those final SHAs. Voice 1.1.0 final images also built.
The first Identity image build failed during npm network download; retry passed
from the same clean source. Nothing from this increment is deployed yet.

The third Core fast gate failed only six nested-document Reader E2E cases
(`framePath is not a function`); all prior type/unit/build/route-budget stages
passed. Playwright Reader PR #9 fixes an overlooked Shared re-export and adds
a package-boundary guard; its full local gate passes, CI pending. It also owns
four address-scheme UI tests. Identity PR #12 owns 29 authentication regressions
and two standalone Chromium session UI cases, with a full passing local gate.
Core removes these copies and retains CORS/admin/resource/WS integration tests.

Core fast gate #4 exited 0: complete workspace checks/builds, unchanged route
budgets and 108 selected browser cases, including all 29 Playwright Reader
integrations. Reader 1.2.2 is published from 6cd0c54f0f7c and all 13 final owner
images are built. Core now pins final published SHAs only.

An import-level audit found eight Reader input component cases, eight Foundation
a11y-validator cases and one Identity login accessibility case still run by Core.
Their complete owner gates pass; PRs Reader #10, UI #6 and Identity #13 own them.
Core removes the two residual suites after that validation. The catalog audit
also found four retained Core browser suites missing from the full gate selection
(sessions/settings/projects/gitPane); assign them to the web host and require
every retained browser suite to be selected. The expanded final gate is pending.
