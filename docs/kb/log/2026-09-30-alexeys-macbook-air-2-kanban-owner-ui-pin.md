---
title: kanban-owner-ui-pin
date: 2026-09-30
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-owner-ui-pin

## Changes

- Updated the optional Kanban Compose image to the exact owner commit that contains the standalone server and portable Projects browser package.

## Findings

- The Core deployment builds only Core. The Kanban image must be loaded locally before enabling the optional profile; GitHub Actions remains disabled.

## Knowledge base

- `docs/kb/deploy.md`.

## Remaining work

- Validate the final owner image and Core consumer integration, then perform a single-writer production cutover and health checks.
