---
title: owner-pack-integrity-format
date: 2026-10-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# owner-pack-integrity-format

## Что сделано

- Core UI (PR #34) и Desktop (PR #12): `scripts/pack.mjs` пишет `artifacts/integrity.json` в форме
  `{ packages: [...] }`, которую читает `owner-release-publish.mjs --source`.

## Что выяснили (факты, которых не было в KB)

- Проверено `--skip-pack --dry-run` на свежей упаковке обоих владельцев: файл принимается без правки.

## Куда занесено

- docs/kb/deploy.md — «Publishing owner releases with archives».

## Открытые вопросы / что осталось

-
