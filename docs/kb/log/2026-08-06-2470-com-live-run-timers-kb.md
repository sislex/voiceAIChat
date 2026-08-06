---
title: live-run-timers-kb
date: 2026-08-06
machine: 2470-com
author: alexeyrozhnov
---

# live-run-timers-kb

## Что сделано

- Обновлены темы ленты CI-рана и выполнения cleanup, затем перегенерирован указатель KB.

## Что выяснили (факты, которых не было в KB)

- Живое время ленты зависит от секундного React-тика и пропа `now`; workdir чата после cleanup восстанавливается только для удалённой released-копии.

## Куда занесено

- docs/kb/ui.md
- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.
