---
title: chat461-accessibility-performance
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# chat461-accessibility-performance

## Changes

CHAT-461: shared focus/hidden-panel handling, skip navigation and route titles,
single-owner live announcements, control contrast, reduced motion, lazy settings
and Release Center, visibility-aware polling, large-list paging and a 720px
mobile boundary. Added Foundations focus/motion, DOM regressions and an
eight-screen Chromium audit with production chunk budgets.

## Verified findings

Settings metadata imported its lazy screen eagerly. PopupFrame had no focus
trap. A hidden task chat panel could receive Tab focus because its display rule
overrode hidden. Toasts nested status/alert roles inside a live parent.
Server polls outside the original three QA panels were not visibility-aware.
Admin already had 40-row server paging and thousand-user coverage.

## Knowledge base

- docs/kb/ui.md: accessibility/performance audit, lazy chunks and polling.
- packages/ui/AGENTS.md: current control-contrast and reduced-motion rules.
- docs/kb/testing-operations.md: desktop's separate dependency installation.

## Validation

- `npm run gate:fast`: exit 0, run
  `20260915210457870-e95ff7ee-6960-4fc6-9e2c-e314a312e9ab`.
- `npm run build:storybook`: passed; the final gate also rebuilt Storybook.
- UI: 3,282 passed, two existing device-dependent tests skipped; all 719
  Storybook axe cases passed without new disabled rules.
- Final E2E group: 25 passed, including eight accessibility screen fixtures and
  three production chunk budgets. Real-route checks also cover five viewport
  sizes in both themes and the board button's bottom-navigation clearance.
- UI kit: 152 passed. Polling: six passed. Sessions: 72 passed and typecheck green.
- `npm run kb:check` and `git diff --check`: exit 0.
- Desktop, agent-tray and login-application dependencies were installed from
  their existing lockfiles; no dependency versions changed.

## Remaining manual checks

Human VoiceOver/NVDA listening and device-level zoom checks. Automated browser
coverage does not substitute for those checks.
