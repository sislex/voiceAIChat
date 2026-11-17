---
title: text-only-system-prompt
date: 2026-11-17
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# text-only-system-prompt

## Changes

Separated text-only conversation data from Core instructions. Added bounded systemPrompt
transport to the model API and capability negotiation with a legacy fallback.

## Verified findings

The previous text-only prompt mixed chat instructions with history on every Claude turn.
The runner's early text-only branch skipped the system-hint assembly.
Make output rules can be separated from the file snapshot without changing answer application.

## Knowledge updated

- docs/kb/llm.md

## Verification

`npm run gate:fast` passed (exit 0): affected application types, tests, builds and contracts.
Targeted transport/model-API tests passed; turns and Make tests passed after correcting the
empty-input guard inherited from appendChatInstructionHints.

## Remaining acceptance

Live Haiku long-article and follow-up acceptance requires the updated Core and runner.
Neither service was released or deployed by this task.
