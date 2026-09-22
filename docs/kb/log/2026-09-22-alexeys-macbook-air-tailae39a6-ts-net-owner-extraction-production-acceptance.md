# Owner extraction production acceptance

Date: 2026-09-22.

Core PR #227 / 0.1.323 completes removal of 31 retired application/library
source directories and consumes immutable owner archives. Both canonical gates
passed, including 126 browser cases; owner-only test migrations have their own
passing gates and PRs. The production cutover updated all thirteen owner service/UI
images plus Core and the independent LLM Runner. Original user worktrees and dev
processes were preserved.

An order-sensitive mount assertion triggered an automatic runner rollback before
Core replacement. The corrected comparison and verified original profile backup
allowed the retry to finish through installed voicechat-deploy. All components
became ready, real Codex and STT/TTS calls passed, and standalone Account worked.
Temporary deployment credentials were verified removed.

Acceptance also exposed a slow account usage report blocking Core's shared DB
lane and tool RPCs. Core PR #228 / 0.1.324 isolates metadata decoding to the selected
account and period; both canonical server gates and PostgreSQL regression checks
passed. The detailed rollout, final browser/API results and backup references are
recorded in deploy.md. Architecture notes now match the actual remote-only runner
and Browser Runner ownership.
