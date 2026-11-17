---
title: make-claude-tool-search
date: 2026-11-17
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# make-claude-tool-search

## Changes

Enabled only ToolSearch among Claude built-ins for toolOnly requests, forced
MCP discovery and disabled automatic memory in per-run settings. Preserved
strict MCP configuration, request tool denials and the textOnly early return.
Added argv and HTTP execution regression coverage in llm-runner.

## Verified findings

The previous toolOnly argv used an empty built-in tool list. Claude's official
MCP documentation confirms this forces eager MCP schema loading. Core already
sets toolOnly for Make; the behavior change belongs to llm-runner.

## Documentation

- docs/kb/features/llm-runners.md

## Outstanding acceptance

The local Claude 2.1.196 CLI reports not logged in. The real first-step token
budget and live Make/browser exercise remain unmeasured. No release or deploy
was performed.
