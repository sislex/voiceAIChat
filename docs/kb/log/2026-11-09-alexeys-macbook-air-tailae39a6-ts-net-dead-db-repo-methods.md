---
title: dead-db-repo-methods
date: 2026-11-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# dead-db-repo-methods

## Что сделано

- Удалены 290 методов репозиториев ядра без вызовов вне тестов (ci, tasks, projects, qa, releases, environments), модули kbHit/testStages/qaStateLogs и тесты, проверявшие только их.
- Тесты живых читателей переведены на засев общих таблиц SQL-запросами.

## Что выяснили (факты, которых не было в KB)

- Процесс CI/QA/автопилота/релизов целиком у канбана; в ядре остались читатели и хуки Identity (attachInvitationsToNewUser, detachDeletedUser, unassignUser). QaRepo пуст.
- Несколько писателей оставлены только как фикстуры тестов — список в architecture.

## Куда занесено

- docs/kb/architecture.md

## Открытые вопросы / что осталось

- Фикстуры-писатели можно вынести в тестовый модуль засева и удалить из репозиториев.
- Кэш цепочек типов проекта в ядре не сбрасывается, когда канбан правит project_types.
