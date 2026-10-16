---
title: universal-search-synchronization
date: 2026-10-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# universal-search-synchronization

## Changes

The universalSearch E2E observes a new browser request before the triggering
action, validates its completed response and waits for the expected visible
option. Six navigation/reload cases and the kanban message context case remain.
TC-1 through TC-4 have executable coverage markers in the E2E file.

## Verified findings

Core UI 1.5.18 debounces nonempty queries by 200 ms, resets query on opening and
does not send another request when a mounted input is filled with its existing
value. The real-client negative observation verifies the last behavior; the
helper clears the unchanged value to explicitly trigger a fresh search.

A controlled browser response shows a local command option before the search
response arrives. Thus option count alone cannot identify search readiness.
A separate real-server case confirms that an HTTP response can be observed
while the corresponding rendered option is not yet visible.

## Acceptance evidence

The final source SHA-256 was
`650569bdd10a9c28ac7564acbdd53552d3431f569f4458d587b8d6018d98e366`.
All three complete browser gates used the same source and exited zero:

| Run | Sum of batch durations | Parallel batch | universalSearch |
| --- | ---: | ---: | ---: |
| 1 | 116.02 s | 2 workers, 37.92 s | 18/18, 18.926 s |
| 2 | 116.62 s | 2 workers, 35.49 s | 18/18, 18.178 s |
| 3 | 115.56 s | 2 workers, 35.74 s | 18/18, 18.337 s |

Each complete run passed 57 cases across 11 files; three existing optional
Electron cases were skipped. universalSearch had no skips or retries. The
acceptance wrapper selects only TC-3/TC-4, so its outer report excludes the
18 ordinary cases; each nested browser report proves that those cases ran.

Across 51 ordinary palette searches, fill-to-request took 201–336 ms,
request-to-completed-response 39–75 ms, and response-to-option 3–34 ms.
This separates the published client's debounce/scheduling from server response
time and React rendering. The controlled response test observed one local
command option before the search response. Unchanged mounted input sent no new
request during the bounded 750 ms negative observation; explicit clearing and
reopening both successfully searched again.

The historical October 6 timeout was not reproduced on this stand. No cold-FTS
or port-conflict cause is claimed. The confirmed defects are an unspecific
readiness condition and the risk of awaiting a nonexistent unchanged-input
request. The existing split navigation cases retain their per-case budgets.

Raw logs, per-run batch reports, exit codes and the parallel batch's Vitest
results are archived in [test evidence](../../test-evidence/universal-search/).
The quick gate used base `35d3a6dc7d4497d3d79acfa2bb7262e5b3104683`
and exited zero. The separate final file run also passed all 18 cases.
The required final `npm run gate:fast` exited zero and ran the complete
universalSearch suite selected from the worktree diff.

## Knowledge topic

Updated the existing Development gate section in
[testing operations](../testing-operations.md#development-gate-npm-run-gate-fast).
