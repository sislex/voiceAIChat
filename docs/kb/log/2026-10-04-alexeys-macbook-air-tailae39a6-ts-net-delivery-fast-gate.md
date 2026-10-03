---
title: delivery-fast-gate
date: 2026-10-04
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# delivery-fast-gate

## Что сделано

- Owner decision: tasks pass on a quick gate, the full gate runs in the background on main and in the
  release regression; failed tests are rerun first after a repair. Plan and task table written,
  AGENTS.md «Required gate» and conventions updated.

## Что выяснили (факты, которых не было в KB)

- Worker gate repair reruns every gate from the start and parses only TAP failures; Kanban and the
  agent have no diff-based gate; Core and Core UI planners select whole suites.

## Куда занесено

- AGENTS.md, docs/kb/conventions.md, docs/plans/delivery-fast-gate*.md.

## Открытые вопросы / что осталось

- Run delivery-fast-gate-v1.
