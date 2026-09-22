---
title: gate-optimization-after-extraction
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Gate optimization after extraction

## Production acceptance

Core PR #230 merged as `823ce54a94c7cca5e2b65da1a6b9a369fe94be27`.
Release 0.1.325 deployed through installed `voicechat-deploy` at 08:03 UTC.
The persistent production Compose configuration selects its pinned image and
read-only Agent/Desktop/Enrollment installers. Other container IDs stayed unchanged.
A PostgreSQL dump was restored successfully into an isolated local database
before cutover; production backup/rollback metadata remains under
`/var/backups/voicechat/sislexa-agent-desktop-325-20260922T080207Z`.

All eight managed dependencies were ready. Provider-specific grants, required
scopes, revocation and rejection of legacy/shared credentials passed. Real browser
login, Users, account/profile/history/machines, Make, Image Studio upload/delete,
Web Reader and Chromium Reader passed. Users loaded in 1.79 seconds; nine requests
to users/signup endpoints returned HTTP 200 in 79–147 ms.

Desktop 1.0.2 logged into production through its packaged origin with isolated
preload. The production IP uses a self-signed certificate: this isolated Electron
smoke explicitly ignored certificate errors, while shipped Desktop keeps normal
TLS verification and needs a trusted certificate. The published Agent 0.20.0 script matched the downloaded bytes, connected
over production WSS and executed an isolated probe command. All three macOS ARM64
DMGs downloaded and matched SHA-256. The initial 30-second download deadline was
too short; the repeat allowed 180 seconds per approximately 100 MB installer and
passed. Real Codex replied `SISLEXA_READY`. Temporary accounts, machines,
conversations, CLI profiles and deployment credentials were removed.

## Gate changes

Compression caching validates source/runtime/options and compressed bytes, always
re-reading sources and parsing import graphs. Corruption and unavailable storage
fall back to compression. Duplicate frontend E2E execution is removed only after
the full frontend gate succeeds. Remaining catalog browser files remain serial;
Git/Settings/Projects use OS-assigned ports. Stages report duration and exit status.
Regression checks cover cache correctness, changed graphs, failure propagation
and complete, nonduplicated ownership of every retained browser suite.

Reference inventories: 43.193 seconds for 140 files. Cold cache: 41.345 seconds;
warm cache: 2.715 seconds. Both resulting JSON inventories have identical SHA-256
to reference (all sizes, fingerprints and import edges). An experimental two-worker gate:fast passed in approximately 639 seconds,
but the following gate exposed a Reader startup timeout and a session fixture
revoking an older row. Two-worker execution was not accepted: final scheduling
remains sequential. The session test now waits for the exact newly created SID
on a distinct device before revocation. No timeout, budget or assertion was weakened.
The unchanged UI suite varied from 146 to 268 seconds between the two runs, so
overall wall time cannot be attributed solely to the optimization. The serial rerun exposed a separate pre-existing Settings fixture race: its
restored lazy dialog appeared after an immediate visibility probe, intercepting
an account-menu click. The helper now waits according to the retained route.
Warm compression and removal of six duplicate panel cases are the retained
performance changes. The final canonical gate passed with exit code 0 in
787.15 seconds (run 20260922090005483-3e66b7ff-7026-47d9-9f97-237979241dc3):
all workspace typechecks/tests/builds, 16 frontend browser cases, 96 unchanged
budget metrics and 120 catalog browser cases. The inner gate:all took 586.17
seconds and the final serial catalog stage took 200.46 seconds. This is not a
claim of a fixed end-to-end speedup: unchanged work varied with machine load.

## Knowledge base

Updated `docs/kb/testing-operations.md`; the task checklist remains in
`docs/plans/agent-desktop-extraction.md`.

The user's original main checkout was synchronized. Ignored artifacts from the
four retired application directories were preserved outside Core at
`../.sislexa-local-archives/2026-09-22-agent-desktop/`; no local configuration or
unknown resource files were deleted. Root dependencies were reinstalled for the
new pinned packages.

Production health and all eight dependencies were rechecked successfully after
more than one hour on 0.1.325.
