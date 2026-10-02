---
title: pin-core-ui-1.4.11-desktop-1.0.14-kanban-0.1.2
date: 2026-10-02
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# pin-core-ui-1.4.11-desktop-1.0.14-kanban-0.1.2

## Что сделано

- environments-v1 U01: released Core UI 1.4.11 (`e91cc203`), Desktop 1.0.14 (`a210c71b`, embeds Core UI 1.4.11)
  and Kanban 0.1.2 (`c4889472`, image `ghcr.io/sislex/sislexa-kanban:c48894724132106415d70498ae6bd3ce265fd127`)
  as GitHub releases via `scripts/owner-release-publish.mjs --source`; Core pins all three.

## Что выяснили (факты, которых не было в KB)

- `owner-release-publish.mjs --source` expects `artifacts/integrity.json` with a `packages` array; Core UI
  and Desktop `pack:release` do not write that form, so publication needs the `packages` form written from
  the archive bytes and `--skip-pack`.

## Куда занесено

- docs/kb/deploy.md (Kanban pin, owner release publication), docs/kb/clients.md (Core UI / Desktop pin).

## Открытые вопросы / что осталось

- Align the owners' `pack:release` output (or the publish script) with the `packages` integrity form.
- Production deployment of this Core release is not done here.
