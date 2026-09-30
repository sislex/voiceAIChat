---
title: pin-combined-make-1-3-1
date: 2026-09-30
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# pin-combined-make-1-3-1

## Что сделано

- Pinned the exact Make 1.3.1 owner archive and container commit `e43736e6` in Core.
- Replaced the old archive, its digest and integrity in both manifests and the lockfile.

## Что выяснили (факты, которых не было в KB)

- The former `8aeae690` release branch has browser quotas but lacks the signed-preview URL fix from `dc2e0e2`. The owner main commit `e43736e6` contains both.

## Куда занесено

- docs/kb/features/make-browser.md

## Открытые вопросы / что осталось

- Publish and deploy the pinned Core and Make images, then verify owner health and browser route.
