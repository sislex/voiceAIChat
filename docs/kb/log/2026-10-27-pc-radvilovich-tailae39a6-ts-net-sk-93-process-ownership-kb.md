---
title: sk-93-process-ownership-kb
date: 2026-10-27
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# sk-93-process-ownership-kb

## Changes

Compared the clean merge worktree at 50e092a9 with origin/dev (no local dev
branch). Expanded the existing LLM ownership section and the CI temporary
cleanup section; no duplicate subsystem article was introduced.

## Verified facts

Core remote-bash registers task commands after policy checks and retains
background children between model calls. The .process-<runId> artifact is a
JSON ownership registry. Documented identity checks, group escalation, sweep
age filters, isolated Gradle homes and task-local cleanup logging.

## Documentation

Updated docs/kb/llm.md and docs/kb/features/ci-runner.md, including their source
areas and freshness. git diff --check and node scripts/kb.mjs check passed;
the latter reports 34 unrelated stale topics and two packages without AGENTS.md.

## Verification boundary

The claimed TMPDIR rename to .tmp-<runId> is not present in this Core diff or
working-copy implementation, so it was not recorded as fact. The Kanban-owned
migration and lifecycle/port admission require verification in sislexa-kanban.
No application code was changed; no commit or push was made.
