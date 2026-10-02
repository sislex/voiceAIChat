---
title: pin-core-ui-1.4.12-desktop-1.0.15
date: 2026-10-02
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# pin-core-ui-1.4.12-desktop-1.0.15

## Что сделано

- Released Core UI 1.4.12 (`00e2e08f`, project list startup recovery from sislex/sislexa-core-ui#30) and
  Desktop 1.0.15 (`87641b56`, embeds Core UI 1.4.12) as GitHub releases via
  `scripts/owner-release-publish.mjs --source`; Core pins both through `scripts/release-composition.mjs apply`.

## Что выяснили (факты, которых не было в KB)

- The `packages` integrity form and `--skip-pack` workaround is still required for both owners.
- `release-composition.mjs apply` does not refresh `provenance.requires`/`provenance.dependencies`; they are
  copied from the archive's `release-source.json`.

## Куда занесено

- docs/kb/clients.md (Core UI / Desktop pin), docs/kb/deploy.md (owner release publication and pinning).

## Открытые вопросы / что осталось

- Align the owners' `pack:release` output (or the publish script) with the `packages` integrity form.
- Production deployment of this Core release is not done here.
