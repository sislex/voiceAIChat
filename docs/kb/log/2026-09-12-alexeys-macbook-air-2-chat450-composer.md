---
title: chat450-composer
date: 2026-09-12
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# CHAT-450 composer and conversation UX

Implemented conversation-scoped draft persistence, captured-recipient retries, local failed-message deletion, clipboard error reporting and rendered-text copying, unread answer counting, local highlighted search, persistent compact density, recording status after capture confirmation, and completed activity folding above five actions. Paste/drop continues through the existing attachment callback.

The submission domain is in `packages/chat-app/src/store/chatStore.ts`. Reading an upload file was asynchronous before its target was captured; the target is now captured first. The voice automaton enters listening before microphone acquisition resolves, so capture confirmation is tracked separately without adding automaton transitions.

Development Brief parsing already enforced a single JSON object. The prompt now explicitly omits unlinked decision question ids; null normalizes to omission, and incompatible links still fail. T9–T11 cover strict format, types and normalization.

Documentation: `docs/kb/ui.md` and `docs/kb/features/task-preparation.md`. Targeted DOM/store/hotkey tests and the 390px Storybook browser geometry check passed during development. The final `npm run gate:fast` passed (exit 0; run `20260912203323198-ce30de22-f35d-43f2-bbae-22cf366ad44f`), including application checks, Storybook, and selected application-release end-to-end tests. All three shared Storybook axe shards passed.
