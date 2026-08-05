---
title: ci-runner-workflow
date: 2026-08-05
machine: 2470-com
author: alexeyrozhnov
---

# ci-runner-workflow

## Что сделано

- Зафиксирована проверенная конфигурация CI-рана ChatAI и порядок его команд.

## Что выяснили (факты, которых не было в KB)

- ChatAI работает от `main` в ветках `feature/{task_number}-{slug}` на машине `45.135.182.251`; репозитории находятся в `/root/VoiceAIChatRepos`.
- Последовательность рана: clone, `npm ci`, `affected-check`, актуализация KB, commit, push, merge, отложенная пересборка `voicechat runner-work runner-personal caddy`, cleanup.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.
