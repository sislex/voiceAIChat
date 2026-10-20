---
title: public-chat-auxiliary-boundary
date: 2026-10-20
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-chat-auxiliary-boundary

## Changes

- Disabled unaccounted auxiliary model dispatch only under trusted public text-only configuration: semantic KB ranking, conversation summaries, project research, retouch, Image Studio Core generation and the compatible Anthropic gateway.
- Preserved lexical KB queries, stored summary reads, ordinary-mode behavior and the removed prompt-suggestion endpoint's 404.
- Added server composition regressions with injected providers, early body rejection and a deterministic real Billing admission denial. No test calls a paid provider.

## Findings

- A successful accounted chat response does not establish that no auxiliary model was used. Auto-KB ranking previously preceded main admission; GET KB queries could also trigger it.
- The failed local 5732 acceptance observed two unaccounted Core service runs alongside four intended settled operations. KB reranking is a source-supported explanation, not a retained runtime callsite trace.

## Documentation

- docs/kb/llm.md
- docs/kb/deploy.md
- docs/plans/public-chat-v1.md

## Remaining validation

- Renewed composed release gates and live local-stand acceptance are required before publication. Prior failed acceptance, ledgers and backup evidence remain unchanged.
