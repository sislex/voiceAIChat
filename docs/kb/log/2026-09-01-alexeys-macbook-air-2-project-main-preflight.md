---
title: project-main-preflight
date: 2026-09-01
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Системный preflight актуальной базовой ветки

## Что сделано

- Обычный проектный LLM-ход блокируется до clean/branch/fetch/fast-forward/SHA-проверки общей Git-копии.
- Подготовка задачи запускает read-only LLM только после того же preflight.
- Development bootstrap синхронизирует настроенную `BASE_BRANCH` и подтверждает совпадение SHA с origin.
- Добавлены регрессионные тесты успешного и заблокированного хода.

## Что выяснили (факты, которых не было в KB)

- `ProjectMainSnapshotCoordinator` существовал как инфраструктура, но production lifecycle его не использовал.
- Preparation-run получал read-only доступ к проектному каталогу без предварительной синхронизации origin.
- Task-workspace с feature-веткой нельзя переключать на main; его актуальностью управляет CI lifecycle.

## Куда занесено

- `docs/kb/machines.md`
- `docs/kb/features/ci-runner.md`
- `docs/kb/features/task-preparation.md`

## Открытые вопросы / что осталось

- Нет.
