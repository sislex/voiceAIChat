---
title: ci-git-transport
date: 2026-08-14
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# ci-git-transport

## Что сделано

- Проверены origin, credential helper и права dry-run по HTTPS и SSH на CI-машине.

## Что выяснили (факты, которых не было в KB)

- Текущее HTTPS-подключение использует аккаунт sislex и имеет право push; SSH-ключ GitHub на машине сейчас не принимается.
- Рекомендация переключить origin на явный SSH не подтверждена и заменена безопасной процедурой диагностики.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.
