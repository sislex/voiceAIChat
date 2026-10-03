---
title: stand-module-profiles
date: 2026-10-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# stand-module-profiles

## Что сделано

- `deploy/compose.stand.yml`: module services behind their profiles; Core, Kanban and Web Reader
  dependencies on modules are `required: false`, so a primary stand runs only the modules Kanban lists.

## Что выяснили (факты, которых не было в KB)

- `make`, `image-studio`, `playwright-reader` and `browser-runner` had no profile in
  `docker-compose.yml`, so a module placed on another machine would still start on the primary.

## Куда занесено

- docs/kb/deploy.md (Managed stands).

## Открытые вопросы / что осталось

- Kanban 0.1.5 and older list only `postgres,kanban`: release Core with this change together with C17.
