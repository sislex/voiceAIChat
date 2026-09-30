---
title: core-ui-148-account-route-budget
date: 2026-09-30
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# core-ui-148-account-route-budget

## Changes

- Doubled every Web and opt-in Electron JS/CSS raw, gzip and Brotli route ceiling at the user's request; Web CSS is now 2,000,000 bytes per metric and route.

## Findings

- The 0.1.349 release preparation failed only on Web Account JS: raw 1,264,211 versus 1,261,100, gzip 382,098 versus 381,300, and Brotli 313,116 versus 312,300 bytes. The same bundle serves cold, warm, and navigation scenarios.

## Knowledge base

- docs/kb/testing-operations.md

## Remaining work

- Run the route gate and create a new Core release after the corrected budget reaches `main`.
