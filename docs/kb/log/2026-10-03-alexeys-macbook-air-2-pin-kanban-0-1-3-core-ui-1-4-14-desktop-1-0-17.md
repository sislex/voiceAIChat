---
title: pin-kanban-0.1.3-core-ui-1.4.14-desktop-1.0.17
date: 2026-10-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# pin-kanban-0.1.3-core-ui-1.4.14-desktop-1.0.17

## Что сделано

- environments-v2 U02: released Kanban 0.1.3 (`87499525`, sislex/sislexa-kanban#16, stage-2 C06–C09/C12)
  as image `ghcr.io/sislex/sislexa-kanban:87499525c622689d32767d437196b3d1590c3f69`, Core UI 1.4.14
  (`703c40a8`, sislex/sislexa-core-ui#37, C10/C11) and Desktop 1.0.17 (`6d810038`, sislex/desktop#13,
  embeds Core UI 1.4.14) as GitHub releases via `scripts/owner-release-publish.mjs --source`.
- Core pins all three with one `scripts/release-composition.mjs apply --dir` (three subdirectories).

## Что выяснили (факты, которых не было в KB)

- Core UI and Desktop `pack:release` now write the publisher `packages` integrity form; no hand-made file.
- `apply` handles the image-only Kanban release too (`deploy/tools.lock.json` and the compose image).
- `apply` still leaves `provenance.requires`/`provenance.dependencies` stale (Core UI `shared` 0.1.14);
  copied from the archives' `release-source.json`.
- Pushing the Kanban image needs a GHCR login with `write:packages`; the GitHub keychain credential has
  only `repo`/`workflow` scopes and is rejected by `docker push`.

## Куда занесено

- docs/kb/clients.md (Core UI / Desktop pin), docs/kb/deploy.md (Kanban pin, owner release publication).

## Открытые вопросы / что осталось

- Production deployment of this Core release is not done here.
