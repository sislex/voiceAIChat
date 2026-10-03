---
title: plan-archive-split
date: 2026-10-04
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# plan-archive-split

## Что сделано

- Convention: worker tasks in plan tables never build or pin contract archives; that is an integrator step.

## Что выяснили (факты, которых не было в KB)

- environments-v3 B04 and environments-v4 B06 stopped at the archive step: a sandboxed worker cannot
  commit, and the archive provenance needs the committed contracts SHA.

## Куда занесено

- docs/kb/conventions.md, docs/plans/environments.md (work order).

## Открытые вопросы / что осталось

- None.
