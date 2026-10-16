---
title: sisl-735-agent-downloads-brief
date: 2026-10-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# sisl-735-agent-downloads-brief

## Changes

Agent Linux/macOS installer and script downloads return exactly Cache-Control:
no-store. TC-1/TC-2 in rest.conversations.test.ts compare exact headers and full
bodies, including forwarded-host/protocol inputs.

## Verified findings

Development Brief parsing belongs to sislex/sislexa-kanban, not Core server.ts.
The owner checkout exposed last-message extraction for Codex and duplicate-key
checking after object construction. The companion patch removes those behaviors,
rejects null/invented decision links, preserves safe field normalization, and
adds TC-3/TC-4 handler regressions.

## Documentation

Updated docs/kb/features/task-preparation.md with current ownership and the
companion patch location. The owner patch updates the existing preparation topic.

## Delivery boundary

Core and Kanban are separate repositories. The companion patch must be applied
in the owner repository; changing Core alone cannot alter the running Kanban
service. No push, publication or deployment is performed by this task.
