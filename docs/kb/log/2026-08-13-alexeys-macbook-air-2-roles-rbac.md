---
title: roles-rbac
date: 2026-08-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# roles-rbac

## Что сделано

- Зафиксирована проектная ролевая модель `admin` / `developer` / `tester` / `observer`, backend-матрица полномочий и её отражение в UI.

## Что выяснили (факты, которых не было в KB)

- Роль проекта и доступ к LLM-моделям независимы: роль фильтрует исполнители через `llm_engines.allowed_roles`, персональные запреты моделей остаются в `user_llm_access`.

## Куда занесено

- `docs/kb/data-auth.md`

## Открытые вопросы / что осталось

- Для `tester` и `observer` отдельная матрица пока не определена; сервер оставляет опасные действия запрещёнными.
