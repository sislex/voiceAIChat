---
title: git-access-project-machine
date: 2026-08-22
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# git-access-project-machine

## Что сделано

- Описан жизненный цикл HTTPS Git credential для связки проекта и машины.

## Что выяснили (факты, которых не было в KB)

- PAT передаётся агенту только структурированной операцией `git.access configure` и не сохраняется сервером.
- Агент использует системный credential helper, а в Termux — отдельный файл с режимом 0600.
- Проверка разделяет `ls-remote` и `push --dry-run`, а диагностика показывает влияние `insteadOf`.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.
