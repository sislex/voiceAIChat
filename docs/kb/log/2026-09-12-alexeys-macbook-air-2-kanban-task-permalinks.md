---
title: kanban-task-permalinks
date: 2026-09-12
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Kanban task permalinks

## Completed

- Added an accessible task-menu action that copies a stable absolute card URL.
- Added visible and live-region feedback for clipboard success and failure.
- Verified encoding, menu isolation, project switching, and a real Chromium clipboard.

## Findings added to the knowledge base

- Task routes already use the `#/projects/:projectId/task/:taskId` contract.
- Deployment pathname must remain in copied URLs for non-root installations.

## Recorded in

- `docs/kb/projects.md`, section "Task card keyboard contract".

## Open questions

- None.
