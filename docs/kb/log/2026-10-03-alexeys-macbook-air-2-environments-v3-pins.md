---
title: environments-v3-pins
date: 2026-10-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# environments-v3-pins

## Что сделано

- Pinned Kanban 0.1.6 (C17–C19), Core UI 1.4.15 (C20), Desktop 1.0.18 (Core UI 1.4.15 + agent 0.21.0)
  with `release-composition.mjs apply`, and agent 0.21.0 / agent-contracts 1.1.0 (C13) by hand.

## Что выяснили (факты, которых не было в KB)

- `release-composition apply` does not know `@sislexa/agent`/`@sislexa/agent-contracts`; they are pinned by
  replacing the vendor archives and the four `package.json` references (root, server, shared,
  component-runtime) and running `npm install`.
- The release snapshot test requires Desktop to embed the pinned Core UI, so a Core UI release needs a
  Desktop release in the same pin.
- `apply` still copies stale `provenance.requires`/`dependencies`; they were taken from each archive's
  `release-source.json`.
- The agent `scripts/pack.mjs` hard-coded 0.20.0 / protocol 1.0.0; it now reads the manifests.

## Куда занесено

- docs/kb/clients.md, docs/kb/deploy.md, docs/kb/machines.md.

## Открытые вопросы / что осталось

- Release, production deployment and agent updates on the machines (U03).
