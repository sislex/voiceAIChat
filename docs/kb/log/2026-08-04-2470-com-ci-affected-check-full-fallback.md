---
title: ci-affected-check-full-fallback
date: 2026-08-04
machine: 2470-com
author: alexeyrozhnov
---

# ci-affected-check-full-fallback

## Что сделано

- Полный fallback `affected-check` снова запускает прежний корневой гейт
  `npm run typecheck && npm test`.

## Что выяснили (факты, которых не было в KB)

- Корневой `npm test` запускает тест `scripts/affected-check.test.mjs`; при
  последовательном запуске только workspace-пакетов этот тест не выполняется.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.
