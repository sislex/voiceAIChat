---
title: environment-run-manifests-git-credentials
date: 2026-08-23
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Манифесты окружений и Git credentials CI-машины

## Что сделано

Дополнена база знаний о строгих environment/run/report manifests, атомарной remote-публикации, preview lifecycle и managed release. Уточнена рабочая HTTPS credential-конфигурация MacBook.

## Что выяснили (факты, которых не было в KB)

Активный Homebrew Git использует кастомный exec-path без `git-credential-osxkeychain`; абсолютный путь к системному helper восстанавливает HTTPS credential flow. Run/report publisher пока интегрирован только в managed-preview, хотя shared-контракт знает все пять типов запусков.

## Куда занесено

`docs/kb/machines.md`, `docs/kb/features/feature-preview.md`, `docs/kb/features/releases.md`, `docs/kb/features/ci-runner.md`.

## Открытые вопросы / что осталось

Подключить run/report manifests к development, QA, merge и release managers.
