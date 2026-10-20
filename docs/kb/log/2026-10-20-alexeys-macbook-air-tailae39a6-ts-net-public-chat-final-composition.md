---
title: public-chat-final-composition
date: 2026-10-20
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-chat-final-composition

## Changes

Integrated the reviewed auxiliary-model policy commit `a1015514cab3b4847e58e287eb5fa2e026211851`
with the exact Core UI 1.5.28 owner archive. Fast-forwarding preserved all four
previously reviewed pin files. Official owner publication and independent
download verification are complete; no stand or production service changed.

## Findings

UI configuration presence controls STT and TTS settings, catalogs and voice deep
links independently. Optional discovery failures do not trigger repeated
bootstrap requests; explicit Settings discovery remains available. The closed
native LLM select fits the desktop and mobile settings pane. Core consumes this
owner implementation without copying its source.

Strict lock refresh and clean installation both passed without lock drift.
All 463 installed UI archive files matched. The unchanged Core settings and
universal-search consumer checks passed 24 tests with one existing skip.
The trusted public auxiliary policy retains its separate reviewed quick-gate
evidence; the final combined gate is still required.

## Knowledge updated

- `docs/kb/clients.md`: current UI pin and optional voice/settings behavior.
- `docs/kb/deploy.md` and `docs/kb/llm.md`: refreshed verification against the
  committed auxiliary boundary without changing their behavior descriptions.
- `docs/plans/public-chat-v1.md`: actual owner/consumer evidence and the pending
  final composition checks, retaining earlier failed acceptance records.

## Remaining work

Freeze this composition before its combined Core gate. Release performance,
installed-owner system acceptance, a new image and local cutover, and bounded
live accounting acceptance must bind the resulting clean commit. The previous
failed live journal remains immutable; the protected production installation
must remain unchanged.
