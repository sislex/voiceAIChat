---
title: sk-93-run-processes
date: 2026-10-27
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# sk-93-run-processes

## Implementation

- Core remote-bash accepts Kanban run/stage ownership and supervises task command process groups.
- Added real process tests and an MCP policy/ownership integration test.

## Verified ownership

- Kanban standalone sends remote machine commands to Core; changing Kanban's unused MCP copy alone does not affect production model commands.
- Core owns command execution and registration; Kanban owns stage/run lifecycle and orphan admission.

## Documentation

- docs/kb/llm.md, Kanban run process ownership (SK-93).

## Follow-up

- Ship the Core and Kanban SK-93 changes together.
