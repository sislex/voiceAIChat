---
title: pin-core-ui-1.4.13-desktop-1.0.16
date: 2026-10-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# pin-core-ui-1.4.13-desktop-1.0.16

## Что сделано

- Released Core UI 1.4.13 (`ae8e3b20`, detail-only project tabs no longer stranded behind their skeleton,
  sislex/sislexa-core-ui#32) and Desktop 1.0.16 (`ac75677d`, embeds Core UI 1.4.13) as GitHub releases via
  `scripts/owner-release-publish.mjs --source`; Core pins both through `scripts/release-composition.mjs apply`.

## Что выяснили (факты, которых не было в KB)

- The `packages` integrity form and `--skip-pack` workaround is still required for both owners.
- `release-composition.mjs apply --dir` expects the parent directory of the per-release subdirectories;
  pointing it at one subdirectory fails with "нет ни одного sislexa-release.json".
- `apply` still leaves the Desktop `provenance.requires`/`provenance.dependencies` stale; copied from the
  archive's `release-source.json`.

## Куда занесено

- docs/kb/clients.md (Core UI / Desktop pin), docs/kb/deploy.md (owner release publication and pinning).

## Открытые вопросы / что осталось

- Align the owners' `pack:release` output (or the publish script) with the `packages` integrity form.
- Production deployment of this Core release is not done here.
