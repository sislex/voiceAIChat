---
title: image-studio-local-attachments
date: 2026-09-12
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# image-studio-local-attachments

## Work completed

- Shared inline attachment materialization between embedded Claude/Codex clients
  and the HTTP runner.
- Made Image Studio prompts reference the exact server paths of source, mask,
  and reference attachments.
- Verified a real MCP retouch through local Codex and checked pixel preservation
  outside the selection.

## Facts learned

- Embedded CLI clients previously ignored `LlmRequest.attachments`; only the HTTP
  runner materialized them.
- A runner can substitute an attachment path only when the prompt contains its
  exact `serverPath`.

## Knowledge base updates

- `docs/kb/llm.md`
- `docs/kb/features/llm-runners.md`
- `docs/kb/server-internals.md`

## Open questions

- None.
