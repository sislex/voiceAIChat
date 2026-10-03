---
title: pin-kanban-0.1.4
date: 2026-10-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# pin-kanban-0.1.4

## Что сделано

- environments-v2 U02 stand check on MakBook M1 16 failed at the `config` stage with
  `unsafe build settings`: Kanban 0.1.3 wrote `COMPOSE_PARALLEL_LIMIT=4`, `COMPOSE_BAKE=true` and
  `VC_KANBAN_MODE=standalone` into `stand.env`.
- Fixed in Kanban 0.1.4 (`18e17cec`, sislex/sislexa-kanban#17): `1` / `false` / `remote`, as in the plan;
  a test asserts the published `stand.env`. Published with `scripts/owner-release-publish.mjs --source`
  and pinned with `scripts/release-composition.mjs apply --dir`.

## Что выяснили (факты, которых не было в KB)

- `environment_stand.py` reports only a generic `Stand operation failed`; the reason is found by running
  `Stand('provision').config()` in the stand checkout on the machine.
- Core treats any `VC_KANBAN_MODE` other than `remote` as Kanban off, so `standalone` silently disabled
  Kanban in a stand.

## Куда занесено

- docs/kb/deploy.md (Kanban pin).

## Открытые вопросы / что осталось

- Production deployment and re-provisioning of `stage2-check`.
