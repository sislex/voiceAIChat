---
title: remote-owner-roots
date: 2026-10-22
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# remote-owner-roots

## Changes

- Added repeated MCP URL roots for owner workspace access through read/edit/grep.
- Added resolver and HTTP regression tests for allowed paths and invalid roots.

## Verified facts

- Additional roots apply only to the selected machine; relative paths remain anchored to cwd.
- This endpoint has no separate write, glob or list tools.

## Knowledge base

- docs/kb/llm.md#проброс-bash-на-машину-пользователя

## Open questions

- None.
