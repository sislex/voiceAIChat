---
title: stable-feature-preview-qa-preparation
date: 2026-08-10
machine: 2470-com
author: alexeyrozhnov
---

# stable-feature-preview-qa-preparation

## Что сделано

- Сверены и актуализированы темы CI-раннера, feature-preview и ручного QA после перехода на стабильные feature-ветки и автоматическую подготовку сценариев.

## Что выяснили (факты, которых не было в KB)

- Новые задачи используют ветку `feature/<task_number>` и workspace `<repos_root>/<project-key>/<task_number>`; зафиксированные legacy-ветки сохраняются как источник истины.
- Preview собирается только из сохранённых branch/SHA результата разработки после проверки чистоты workspace и SHA в origin.
- Вход в `qa_preparation` запускает один LLM-ран на пару task + commit SHA; новый SHA делает активную QA session stale.

## Куда занесено

- `docs/kb/features/ci-runner.md`
- `docs/kb/features/feature-preview.md`
- `docs/kb/features/manual-qa.md`

## Открытые вопросы / что осталось

- Маршрутизируемый preview URL с ACL не реализован; loopback-ссылки UI честно помечает недоступными извне.
